document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("codeInput");
  const btn = document.getElementById("goBtn");

  if (btn && input) {
    btn.addEventListener("click", () => {
      const v = input.value.trim();
      if (!v) return;
      location.href = `/DVK/track/?code=${encodeURIComponent(v)}`;
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
    });
  }
});

(() => {
  const subLine = document.getElementById("subLine");
  const shipmentCard = document.getElementById("shipmentCard");
  const stopsCard = document.getElementById("stopsCard");
  const eventsCard = document.getElementById("eventsCard");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnPdf = document.getElementById("btnPdf");

  function qParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function esc(s) {
    return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function normalizeStops(sh) {
    let raw = sh?.stops;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    if (Array.isArray(raw) && raw.length) {
      return raw.map(x => ({
        type: (x.type || "delivery") === "pickup" ? "pickup" : "delivery",
        address: String(x.address ?? "").trim(),
        prio: !!x.prio,
        status: x.status ?? null,
        proof: x.proof ?? null,
      })).filter(s => s.address);
    }
    const out = [];
    if (sh.pickup_address) out.push({ type:"pickup", address: sh.pickup_address, prio: !!sh.pickup_prio, status:null, proof:null });
    if (sh.delivery_address) out.push({ type:"delivery", address: sh.delivery_address, prio: !!sh.delivery_prio, status:null, proof:null });
    return out;
  }

  function labelStatus(st) {
    const map = {
      AANGEMAAKT: "Aangemaakt",
      OPGEHAALD: "Opgehaald",
      ONDERWEG: "Onderweg",
      AFGELEVERD: "Afgeleverd",
      PROBLEEM: "Probleem",
      GEARCHIVEERD: "Gearchiveerd",
    };
    return map[st] || (st || "-");
  }

  async function ensureClient() {
    if (!window.supabaseClient) throw new Error("supabaseClient ontbreekt");
    return window.supabaseClient;
  }

  async function load() {
    const code = qParam("code");
    if (!code) {
      subLine.textContent = "Geen code meegegeven (?code=DVK...)";
      return;
    }

    subLine.textContent = `Code: ${code} • laden…`;

    const supabaseClient = await ensureClient();

    const { data: sh, error } = await supabaseClient
      .from("shipments")
      .select("*, stops")
      .eq("track_code", code)
      .single();

    if (error || !sh) {
      subLine.textContent = "Niet gevonden.";
      shipmentCard.innerHTML = `<b>Niet gevonden</b><div class="muted">Controleer de code.</div>`;
      stopsCard.innerHTML = "";
      eventsCard.innerHTML = "";
      return;
    }

    const stops = normalizeStops(sh);

    // Events
    const { data: events } = await supabaseClient
      .from("shipment_events")
      .select("event_type, note, stop_index, created_at")
      .eq("shipment_id", sh.id)
      .order("created_at", { ascending: true });

    // Render shipment
    subLine.textContent = `Code: ${code} • Status: ${labelStatus(sh.status)}`;

    shipmentCard.innerHTML = `
      <div style="font-weight:800;font-size:16px;">${esc(sh.track_code)} — ${esc(sh.customer_name || "")}</div>
      <div class="muted">Type: ${esc(sh.shipment_type === "overig" ? (sh.shipment_type_other || "overig") : (sh.shipment_type || ""))} • Colli: ${esc(sh.colli_count ?? "")}</div>
      <div style="margin-top:8px;"><span class="tag">Status</span> <b>${esc(labelStatus(sh.status))}</b></div>
    `;

    // Render stops
    const stopHtml = stops.map((s, idx) => {
      const tag = s.type === "pickup" ? "Ophalen" : "Bezorgen";
      const st = s.status ? labelStatus(s.status) : "—";
      const prio = s.prio ? ` <span class="prio">PRIO</span>` : "";

      // proof: multi-stop proof in stop.proof; single proof on shipment fields
      const proof = s.proof || null;
      const singleProof = (stops.length <= 2 && s.type === "delivery" && sh.status === "AFGELEVERD")
        ? {
            receiver_name: sh.receiver_name,
            delivered_note: sh.delivered_note,
            signature_path: sh.signature_path,
            photo1_path: sh.photo1_path,
            photo2_path: sh.photo2_path,
            delivered_at: sh.delivered_at,
          }
        : null;

      const p = proof || singleProof;

      const proofHtml = p ? `
        <div class="muted" style="margin-top:6px;">
          <div><b>Ontvanger:</b> ${esc(p.receiver_name || "")}</div>
          ${p.delivered_at ? `<div><b>Tijd:</b> ${esc(new Date(p.delivered_at).toLocaleString())}</div>` : ""}
          ${p.delivered_note ? `<div><b>Opmerking:</b> ${esc(p.delivered_note)}</div>` : ""}
          <div>${p.signature_path ? `Handtekening: ✅` : `Handtekening: —`}</div>
          <div>${(p.photo1_path || p.photo2_path) ? `Foto’s: ✅` : `Foto’s: —`}</div>
        </div>
      ` : "";

      return `
        <div class="stop">
          <div><b>${idx + 1}. ${esc(tag)}:</b> ${esc(s.address)}${prio}</div>
          <div class="muted">Status: <b>${esc(st)}</b></div>
          ${proofHtml}
        </div>
      `;
    }).join("");

    // Als er geen events zijn, bouw tijdpad op uit stops
let timelineHtml = evHtml;

if (!timelineHtml) {
  const stopEvents = (stops || []).map((st, i) => {
    const type = st.type === "pickup" ? "Ophalen" : "Bezorgen";
    const label = `${i+1}. ${type}: ${st.address} → ${st.status || "Onbekend"}`;
    return `<li>${label}</li>`;
  }).join("");

  timelineHtml = stopEvents || '<li class="muted">Nog geen tijdpad.</li>';
}

sCard.innerHTML = `
  <div style="font-weight:800;">Tijdpad</div>
  <ul style="margin:8px 0 0 18px;">
    ${timelineHtml}
  </ul>
`;

    // ===== Tijdpad (altijd tonen) =====
const stopsSafe  = Array.isArray(stops)  ? stops  : [];
const eventsSafe = Array.isArray(events) ? events : [];

let timelineItems = "";

// 1) Als er echte events zijn
if (eventsSafe.length) {
  timelineItems = eventsSafe.map(ev => {
    const t = ev.created_at ? new Date(ev.created_at).toLocaleString("nl-NL") : "";
    const msg = ev.event_type || ev.status || "Event";
    return `<li>${t ? `<strong>${t}</strong> — ` : ""}${esc(msg)}</li>`;
  }).join("");
}

// 2) Anders fallback uit stops
if (!timelineItems) {
  timelineItems = stopsSafe.map((st, i) => {
    const type = st?.type === "pickup" ? "Ophalen" : "Bezorgen";
    const addr = st?.address || "-";
    const stt  = st?.status || "Onbekend";
    return `<li>${i + 1}. ${type}: ${esc(addr)} — <strong>${esc(stt)}</strong></li>`;
  }).join("");
}

// 3) Als zelfs dat leeg is
if (!timelineItems) timelineItems = `<li class="muted">Nog geen tijdpad.</li>`;

eventsCard.innerHTML = `
  <div style="font-weight:800;">Tijdpad</div>
  <ul style="margin:8px 0 0 18px;">
    ${timelineItems}
  </ul>
`;

    // PDF knop
    btnPdf.onclick = () => makePdf(sh, stops, events || []);
  }

  async function makePdf(sh, stops, events) {
    if (!window.jspdf?.jsPDF) {
      alert("jsPDF niet geladen.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    let y = 40;
    const line = (txt, bold=false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(11);
      const split = doc.splitTextToSize(String(txt), 520);
      doc.text(split, 40, y);
      y += 16 * split.length;
      if (y > 770) { doc.addPage(); y = 40; }
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Afleverbon / Bewijs van levering", 40, y); y += 22;

    line(`Trackcode: ${sh.track_code}`, true);
    line(`Klant: ${sh.customer_name || ""}`);
    line(`Type: ${sh.shipment_type === "overig" ? (sh.shipment_type_other || "overig") : (sh.shipment_type || "")} • Colli: ${sh.colli_count ?? ""}`);
    line(`Status: ${sh.status}`);

    y += 8;
    line("Adressen:", true);
    stops.forEach((s, idx) => {
      const tag = s.type === "pickup" ? "Ophalen" : "Bezorgen";
      const st = s.status || "";
      line(`${idx + 1}. ${tag}: ${s.address} ${s.prio ? "(PRIO)" : ""} — ${st}`);
      const p = s.proof || null;
      if (p) {
        line(`   Ontvanger: ${p.receiver_name || ""}`);
        if (p.delivered_at) line(`   Tijd: ${new Date(p.delivered_at).toLocaleString()}`);
        if (p.delivered_note) line(`   Opmerking: ${p.delivered_note}`);
      }
    });

    y += 8;
    line("Tijdpad:", true);
    events.forEach((e) => {
      const t = e.created_at ? new Date(e.created_at).toLocaleString() : "";
      const si = (e.stop_index === 0 || e.stop_index) ? ` (stop ${Number(e.stop_index) + 1})` : "";
      line(`${t} — ${e.event_type}${si}${e.note ? ` • ${e.note}` : ""}`);
    });

    doc.save(`Afleverbon-${sh.track_code}.pdf`);
  }

  btnRefresh?.addEventListener("click", load);
  load();
})();
