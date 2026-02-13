function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function badge(status) {
  const map = {
    AANGEMAAKT: "Aangemaakt",
    OPGEHAALD: "Opgehaald",
    ONDERWEG: "Onderweg",
    PROBLEEM: "Probleem",
    AFGELEVERD: "Afgeleverd",
    GEARCHIVEERD: "Gearchiveerd"
  };
  return map[status] || status;
}

function fmt(dt) {
  try {
    return new Date(dt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return dt;
  }
}

async function ensureClient() {
  if (!window.supabaseClient) throw new Error("supabaseClient missing");
  return window.supabaseClient;
}

async function loadTrack() {
  const code = (qs("code") || "").trim().toUpperCase();
  const out = document.getElementById("out");
  const msg = document.getElementById("msg");
  const codeEl = document.getElementById("code");
  const btn = document.getElementById("btn");

  msg.textContent = "";
  out.innerHTML = "";

  if (!code) {
    msg.textContent = "Voer je Track & Trace code in.";
    return;
  }

  codeEl.value = code;
  btn.disabled = true;
  msg.textContent = "Ophalen...";

  try {
    const supabaseClient = await ensureClient();

    // shipment info
    const { data: ship, error: e1 } = await supabaseClient.rpc("get_public_shipment", { p_track_code: code });
    if (e1) throw e1;
    if (!ship || ship.length === 0) {
      msg.textContent = "Geen zending gevonden met deze code.";
      btn.disabled = false;
      return;
    }
    const s = ship[0];

    // events
    const { data: events, error: e2 } = await supabaseClient.rpc("get_public_events", { p_track_code: code });
    if (e2) throw e2;

    msg.textContent = "";

    const typeText = (s.shipment_type === "overig") ? (s.shipment_type_other || "overig") : s.shipment_type;

    out.innerHTML = `
      <div class="card">
        <h1>Track & Trace</h1>
        <div class="row">
          <div><b>Code:</b> ${esc(s.track_code)}</div>
          <div><b>Status:</b> ${esc(badge(s.status))}</div>
        </div>
        <hr/>
        <div class="row">
          <div><b>Ophaaladres:</b><br/>${esc(s.pickup_address)}</div>
          <div><b>Bezorgadres:</b><br/>${esc(s.delivery_address)}</div>
        </div>
        <div class="row">
          <div><b>Type:</b> ${esc(typeText)}</div>
          <div><b>Aantal colli:</b> ${esc(s.colli_count)}</div>
        </div>

        ${s.problem_note ? `<p class="warn"><b>Probleem:</b> ${esc(s.problem_note)}</p>` : ""}

        ${s.receiver_name ? `<p><b>Ontvangen door:</b> ${esc(s.receiver_name)}</p>` : ""}

        ${s.delivered_note ? `<p><b>Opmerking:</b> ${esc(s.delivered_note)}</p>` : ""}

        <h2>Tijdlijn</h2>
        <div class="timeline" id="tl"></div>

        <hr/>
        <p class="small">
          Afleverbon beschikbaar na levering (indien van toepassing).<br/>
          Contact: De Vechtse Koeriers • info@dbparcel.com • 0625550524
        </p>
      </div>
    `;

    const tl = document.getElementById("tl");
    if (!events || events.length === 0) {
      tl.innerHTML = `<small>Geen updates.</small>`;
    } else {
      tl.innerHTML = events.map(ev => {
        const note = ev.note ? `<div class="small">${esc(ev.note)}</div>` : "";
        return `
          <div class="tl-item">
            <div class="tl-time">${esc(fmt(ev.created_at))}</div>
            <div class="tl-title">${esc(badge(ev.event_type))}</div>
            ${note}
          </div>
        `;
      }).join("");
    }
  } catch (err) {
    console.error(err);
    msg.textContent = "Fout bij ophalen. Probeer opnieuw.";
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn");
  btn.addEventListener("click", loadTrack);

  // auto-load als ?code=... in URL zit
  if (qs("code")) loadTrack();
});
