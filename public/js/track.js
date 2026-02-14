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

let currentShipmentId = null;
let channel = null;

function setMsg(text, kind = "muted") {
  msgEl.className = kind === "err" ? "err" : kind === "ok" ? "ok" : "muted";
  msgEl.textContent = text || "";
}

function fmt(dt) {
  try {
    const d = new Date(dt);
    return isNaN(d) ? "" : d.toLocaleString("nl-NL");
  } catch { return ""; }
}

function labelStatus(s) {
  const map = {
    "AANGEMAAKT": "Aangemaakt",
    "OPGEHAALD": "Opgehaald",
    "ONDERWEG": "Onderweg",
    "AFGELEVERD": "Afgeleverd",
    "PROBLEEM": "Probleem",
    "GEARCHIVEERD": "Gearchiveerd",
  };
  return map[s] || s || "-";
}

async function ensureClient() {
  if (!window.supabaseClient) throw new Error("supabaseClient ontbreekt (supabase-config.js)");
  return window.supabaseClient;
}

// Render
function renderShipment(sh) {
  resultEl.style.display = "block";
  trackcodeEl.textContent = sh.track_code || "";
  statusEl.textContent = labelStatus(sh.status);

  pickupEl.textContent = sh.pickup_address || "-";
  deliveryEl.textContent = sh.delivery_address || "-";

  const t = sh.shipment_type === "overig"
    ? (sh.shipment_type_other || "overig")
    : (sh.shipment_type || "-");
  typeEl.textContent = t;

  colliEl.textContent = (sh.colli_count ?? "-");
  receiverEl.textContent = sh.receiver_name || "-";
  noteEl.textContent = sh.delivered_note || "-";

  function renderShipment(sh) {
  resultEl.style.display = "block";
  trackcodeEl.textContent = sh.track_code || "";
  statusEl.textContent = labelStatus(sh.status);

  pickupEl.textContent = sh.pickup_address || "-";
  deliveryEl.textContent = sh.delivery_address || "-";

  const t = sh.shipment_type === "overig"
    ? (sh.shipment_type_other || "overig")
    : (sh.shipment_type || "-");
  typeEl.textContent = t;

  colliEl.textContent = (sh.colli_count ?? "-");

  // ✅ Alleen tonen na AFGELEVERD of GEARCHIVEERD (of zodra archived_at gevuld is)
  const showAfter = sh.status === "AFGELEVERD" || sh.status === "GEARCHIVEERD" || !!sh.archived_at;
  if (afterDeliveryCard) afterDeliveryCard.style.display = showAfter ? "block" : "none";
}
}

function renderTimeline(events) {
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

// RPC call
async function fetchByCode(trackCode) {
  const supabaseClient = await ensureClient();
  // We halen alles via RPC zodat anon veilig blijft
  const { data, error } = await supabaseClient.rpc("dvk_track_lookup", { p_code: trackCode });
  if (error) throw error;
  return data; // { shipment: {...}, events: [...] } of null
}

async function load(trackCode) {
  setMsg("Zoeken...", "muted");
  resultEl.style.display = "none";
  currentShipmentId = null;

  const data = await fetchByCode(trackCode);

  if (!data || !data.shipment) {
    setMsg("Geen zending gevonden voor deze trackcode.", "err");
    return;
  }

  setMsg("Gevonden ✅", "ok");
  renderShipment(data.shipment);
  renderTimeline(data.events || []);
  currentShipmentId = data.shipment.id;

  // realtime aanzetten
  await setupRealtime(trackCode);
}

async function setupRealtime(trackCode) {
  const supabaseClient = await ensureClient();

  // oude channel weg
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }

  liveEl.textContent = "Live updates actief";

  channel = supabaseClient
    .channel("track_live_" + trackCode)
    .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, async () => {
      // herlaad via RPC (veilig)
      try {
        const data = await fetchByCode(trackCode);
        if (data?.shipment) renderShipment(data.shipment);
      } catch {}
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "shipment_events" }, async () => {
      try {
        const data = await fetchByCode(trackCode);
        if (data?.events) renderTimeline(data.events);
      } catch {}
    })
    .subscribe();
}

// UI events
btnEl.addEventListener("click", async () => {
  const code = (codeEl.value || "").trim();
  if (!code) return setMsg("Vul een trackcode in.", "err");
  try {
    await load(code);
  } catch (e) {
    console.error(e);
    setMsg("Fout bij ophalen: " + (e?.message || e), "err");
  }
});

codeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnEl.click();
});

// autoload via ?code=
(() => {
  const p = new URLSearchParams(window.location.search);
  const c = p.get("code");
  if (c) {
    codeEl.value = c;
    btnEl.click();
  } else {
    setMsg("Voer uw trackcode in om de zending te bekijken.", "muted");
  }
})();
