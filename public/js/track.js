// DVK Track & Trace (Klant)
// - Haalt data op via RPC: dvk_track_lookup(p_code)
// - Toont ontvanger + opmerking
// - Dedupe tijdpad (geen dubbele "Aangemaakt")
// - Live updates zonder refresh (Realtime op shipments + shipment_events, gefilterd op shipment_id)
// - Toont melding "Afleverbon opvraagbaar..." alleen bij AFGELEVERD/GEARCHIVEERD (of archived_at)

// ---------------- DOM
const codeEl = document.getElementById("code");
const btnEl = document.getElementById("btn");
const msgEl = document.getElementById("msg");

const resultEl = document.getElementById("result");
const trackcodeEl = document.getElementById("trackcode");
const statusEl = document.getElementById("status");
const pickupEl = document.getElementById("pickup");
const deliveryEl = document.getElementById("delivery");
const typeEl = document.getElementById("type");
const colliEl = document.getElementById("colli");
const noteEl = document.getElementById("note");
const timelineEl = document.getElementById("timeline");
const liveEl = document.getElementById("live");

// Extra blok (die heb jij in index.html toegevoegd)
const afterCardEl = document.getElementById("afterDeliveryCard");
const afterTextEl = document.getElementById("afterDeliveryText");

// ---------------- STATE
let currentShipmentId = null;
let channelShipments = null;
let channelEvents = null;

// ---------------- Helpers
function setMsg(text, kind = "muted") {
  if (!msgEl) return;
  msgEl.className = kind === "err" ? "err" : kind === "ok" ? "ok" : "muted";
  msgEl.textContent = text || "";
}

function fmt(dt) {
  try {
    const d = new Date(dt);
    return isNaN(d) ? "" : d.toLocaleString("nl-NL");
  } catch {
    return "";
  }
}

function labelStatus(s) {
  const map = {
    AANGEMAAKT: "Aangemaakt",
    OPGEHAALD: "Opgehaald",
    ONDERWEG: "Onderweg",
    AFGELEVERD: "Afgeleverd",
    PROBLEEM: "Probleem",
    GEARCHIVEERD: "Gearchiveerd",
  };
  return map[s] || s || "-";
}

async function ensureClient() {
  if (!window.supabaseClient) {
    throw new Error("supabaseClient ontbreekt (controleer supabase-config.js)");
  }
  return window.supabaseClient;
}

// ---------------- Data ophalen (RPC)
async function fetchByCode(trackCode) {
  const supabaseClient = await ensureClient();
  const { data, error } = await supabaseClient.rpc("dvk_track_lookup", { p_code: trackCode });
  if (error) throw error;
  return data; // { shipment: {...}, events: [...] } of null
}

// ---------------- Render shipment
function renderShipment(sh) {
  if (!resultEl) return;

  resultEl.style.display = "block";

  trackcodeEl.textContent = sh.track_code || "";
  statusEl.textContent = labelStatus(sh.status);

  pickupEl.textContent = sh.pickup_address || "-";
  deliveryEl.textContent = sh.delivery_address || "-";

  const t =
    sh.shipment_type === "overig"
      ? (sh.shipment_type_other || "overig")
      : (sh.shipment_type || "-");
  typeEl.textContent = t;

  colliEl.textContent = (sh.colli_count ?? "-");

  // ✅ Ontvanger + opmerking (alleen ingevuld na afleveren)
  noteEl.textContent = sh.delivered_note || "-";

  // ✅ Afleverbon melding alleen bij AFGELEVERD/GEARCHIVEERD (of archived_at)
  const showAfter =
    sh.status === "AFGELEVERD" ||
    sh.status === "GEARCHIVEERD" ||
    !!sh.archived_at;

  if (afterCardEl) afterCardEl.style.display = showAfter ? "block" : "none";
  if (afterTextEl) {
    afterTextEl.innerHTML = `Afleverbon en eventuele afleverfoto’s zijn op verzoek opvraagbaar bij <b>De Vechtse Koeriers</b>.`;
  }
}

// ---------------- Timeline (dedupe)
function dedupeEvents(events) {
  // 1) als er een unieke id is -> daarop dedupen
  const hasId = events?.some(e => e && e.id != null);

  const seen = new Set();
  const out = [];

  for (const ev of (events || [])) {
    if (!ev) continue;

    const key = hasId
      ? `id:${ev.id}`
      : `${ev.event_type || ""}__${ev.created_at || ""}__${ev.note || ""}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }

  // sort: oud -> nieuw
  out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return out;
}

function renderTimeline(events) {
  if (!timelineEl) return;

  timelineEl.innerHTML = "";

  // Dedupe: zelfde event_type + zelfde tijd (op seconde) maar 1x tonen
const seen = new Set();
const cleaned = [];

for (const ev of (events || [])) {
  const t = ev.created_at ? new Date(ev.created_at) : null;
  const keyTime = t && !isNaN(t) ? Math.floor(t.getTime() / 1000) : "x";
  const key = `${ev.event_type || ""}|${keyTime}`;

  if (seen.has(key)) continue;
  seen.add(key);
  cleaned.push(ev);
}

// werk verder met cleaned i.p.v. events
events = cleaned;

  if (!events || events.length === 0) {
  timelineEl.innerHTML = `<div class="muted">Nog geen updates beschikbaar.</div>`;
  return;
}

for (const ev of events) {
    const div = document.createElement("div");
    div.className = "ev";

    const when = fmt(ev.created_at);
    const kind = labelStatus(ev.event_type);

    div.innerHTML = `
      <div class="t">${when}</div>
      <div class="k">${kind}</div>
      ${ev.event_type === "PROBLEEM" && ev.note ? `<div class="n">${ev.note}</div>` : ""}
    `;
    timelineEl.appendChild(div);
  }
}

// ---------------- Live updates (Realtime)
async function setupRealtime(shipmentId, trackCode) {
  const supabaseClient = await ensureClient();

  // Oude channels netjes weg
  try {
    if (channelShipments) supabaseClient.removeChannel(channelShipments);
    if (channelEvents) supabaseClient.removeChannel(channelEvents);
  } catch {}
  channelShipments = null;
  channelEvents = null;

  if (liveEl) liveEl.textContent = "Live updates actief";

  // Filter alleen deze zending
  channelShipments = supabaseClient
    .channel(`track_ship_${trackCode}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments", filter: `id=eq.${shipmentId}` },
      async () => {
        try {
          const data = await fetchByCode(trackCode);
          if (data?.shipment) renderShipment(data.shipment);
          if (data?.events) renderTimeline(data.events);
        } catch (e) {
          // stil falen
        }
      }
    )
    .subscribe();

  channelEvents = supabaseClient
    .channel(`track_ev_${trackCode}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
      async () => {
        try {
          const data = await fetchByCode(trackCode);
          if (data?.shipment) renderShipment(data.shipment);
          if (data?.events) renderTimeline(data.events);
        } catch (e) {
          // stil falen
        }
      }
    )
    .subscribe();
}

// ---------------- Load flow
async function load(trackCode) {
  setMsg("Zoeken...", "muted");
  if (resultEl) resultEl.style.display = "none";
  currentShipmentId = null;

  const data = await fetchByCode(trackCode);

  if (!data || !data.shipment) {
    setMsg("Geen zending gevonden voor deze trackcode.", "err");
    if (liveEl) liveEl.textContent = "";
    if (afterCardEl) afterCardEl.style.display = "none";
    return;
  }

  setMsg("Gevonden ✅", "ok");

  renderShipment(data.shipment);
  renderTimeline(data.events || []);

  currentShipmentId = data.shipment.id;

  // ✅ realtime aanzetten
  await setupRealtime(currentShipmentId, trackCode);
}

// ---------------- UI events
if (btnEl) {
  btnEl.addEventListener("click", async () => {
    const code = (codeEl?.value || "").trim();
    if (!code) return setMsg("Vul een trackcode in.", "err");

    try {
      await load(code);
    } catch (e) {
      console.error(e);
      setMsg("Fout bij ophalen: " + (e?.message || e), "err");
    }
  });
}

if (codeEl) {
  codeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnEl?.click();
  });
}

// autoload via ?code=
(() => {
  const p = new URLSearchParams(window.location.search);
  const c = p.get("code");
  if (c && codeEl) {
    codeEl.value = c;
    btnEl?.click();
  } else {
    setMsg("Voer uw trackcode in om de zending te bekijken.", "muted");
  }
})();
