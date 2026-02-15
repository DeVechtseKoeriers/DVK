// DVK Track & Trace (Customer) - Clean & Working
// - Lookup via RPC: dvk_track_lookup (anon veilig)
// - Toon ontvanger + opmerking (receiver_name + delivered_note)
// - Toon afleverbon melding alleen bij AFGELEVERD of GEARCHIVEERD
// - Realtime updates (shipments + shipment_events) zonder refresh

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

const receiverEl = document.getElementById("receiver");
const noteEl = document.getElementById("note");

const timelineEl = document.getElementById("timeline");
const liveEl = document.getElementById("live");

const afterCard = document.getElementById("afterDeliveryCard");
const afterText = document.getElementById("afterDeliveryText");

let channel = null;

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
  if (!window.supabaseClient) throw new Error("supabaseClient ontbreekt (supabase-config.js)");
  return window.supabaseClient;
}

// ---------- Render shipment
function renderShipment(sh) {
  if (!resultEl) return;
  resultEl.style.display = "block";

  if (trackcodeEl) trackcodeEl.textContent = sh.track_code || "";
  if (statusEl) statusEl.textContent = labelStatus(sh.status);

  if (pickupEl) pickupEl.textContent = sh.pickup_address || "-";
  if (deliveryEl) deliveryEl.textContent = sh.delivery_address || "-";

  const t =
    sh.shipment_type === "overig"
      ? (sh.shipment_type_other || "overig")
      : (sh.shipment_type || "-");
  if (typeEl) typeEl.textContent = t;

  if (colliEl) colliEl.textContent = (sh.colli_count ?? "-");

  // ✅ Ontvanger + Opmerking tonen
  if (receiverEl) receiverEl.textContent = sh.receiver_name || "-";
  if (noteEl) noteEl.textContent = sh.delivered_note || "-";

  // ✅ Afleverbon melding alleen bij AFGELEVERD of GEARCHIVEERD
  const showAfter = sh.status === "AFGELEVERD" || sh.status === "GEARCHIVEERD" || !!sh.archived_at;
  if (afterCard) afterCard.style.display = showAfter ? "block" : "none";
  if (afterText && showAfter) {
    afterText.innerHTML = `
      Afleverbon is opvraagbaar bij <b>De Vechtse Koeriers</b>.<br/>
      Eventuele afleverfoto’s zijn op verzoek beschikbaar.
    `;
  }

  // Live label
  if (liveEl) {
    liveEl.textContent = "Live updates actief";
  }
}

// ---------- Render timeline
function renderTimeline(events) {
  if (!timelineEl) return;
  timelineEl.innerHTML = "";

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

// ---------- RPC call (anon veilig)
async function fetchByCode(trackCode) {
  const supabaseClient = await ensureClient();
  const { data, error } = await supabaseClient.rpc("dvk_track_lookup", { p_code: trackCode });
  if (error) throw error;
  return data; // { shipment: {...}, events: [...] } of null
}

// ---------- Load and render
async function load(trackCode) {
  setMsg("Zoeken...", "muted");
  if (resultEl) resultEl.style.display = "none";

  const data = await fetchByCode(trackCode);

  if (!data || !data.shipment) {
    setMsg("Geen zending gevonden voor deze trackcode.", "err");
    if (liveEl) liveEl.textContent = "";
    return;
  }

  setMsg("Gevonden ✅", "ok");
  renderShipment(data.shipment);
  renderTimeline(data.events || []);

  await setupRealtime(trackCode);
}

// ---------- Realtime (zonder refresh)
async function setupRealtime(trackCode) {
  const supabaseClient = await ensureClient();

  // oude channel weg
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }

  // ✅ Filter op track_code zodat niet elke wijziging in heel de DB triggert
  channel = supabaseClient
    .channel("track_live_" + trackCode)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments", filter: `track_code=eq.${trackCode}` },
      async () => {
        try {
          const data = await fetchByCode(trackCode);
          if (data?.shipment) renderShipment(data.shipment);
        } catch {}
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipment_events" },
      async () => {
        // shipment_events heeft geen track_code; we herladen veilig via RPC
        try {
          const data = await fetchByCode(trackCode);
          if (data?.events) renderTimeline(data.events);
          if (data?.shipment) renderShipment(data.shipment);
        } catch {}
      }
    )
    .subscribe((status) => {
      if (liveEl) {
        liveEl.textContent =
          status === "SUBSCRIBED" ? "Live updates actief" : "Live updates verbinden...";
      }
    });
}

// ---------- UI events
if (btnEl) {
  btnEl.addEventListener("click", async () => {
    const code = (codeEl?.value || "").trim();
    if (!code) return setMsg("Vul een trackcode in.", "err");

    try {
      await load(code);
    } catch (e) {
      console.error(e);
      setMsg("Fout bij ophalen: " + (e?.message || e), "err");
      if (liveEl) liveEl.textContent = "";
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
