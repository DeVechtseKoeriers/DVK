// public/js/track.js

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
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
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
    return map[String(st || "").toUpperCase()] || (st || "Onbekend");
  }

  function eventTypeToNice(eventType) {
    const e = String(eventType || "").toUpperCase();
    const map = {
      AANGEMAAKT: "Aangemaakt",
      OPGEHAALD: "Opgehaald",
      ONDERWEG: "Onderweg",
      AFGELEVERD: "Afgeleverd",
      PROBLEEM: "Probleem",
    };
    return map[e] || (eventType || "Event");
  }

  function fmtDateTimeNL(v) {
    if (!v) return "";
    try {
      return new Date(v).toLocaleString("nl-NL", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  // Laat in de UI DVK2026 + 6 cijfers zien (maar database blijft volledige code)
  function displayTrackCode(trackCode) {
    const s = String(trackCode || "");
    const m = s.match(/^(DVK)(\d{4})(\d+)/i);
    if (!m) return s;
    const prefix = m[1].toUpperCase();
    const year = m[2];
    const rest = m[3] || "";
    return `${prefix}${year}${rest.slice(0, 6)}`; // max 6 cijfers na het jaar
  }

  function normalizeStops(sh) {
    let raw = sh?.stops;

    // stops kan JSON-string zijn
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }

    // Moderne stops-array
    if (Array.isArray(raw) && raw.length) {
      return raw
        .map((x, idx) => ({
          stop_index: (x.stop_index === 0 || x.stop_index) ? Number(x.stop_index) : idx,
          type: (String(x.type || "delivery").toLowerCase() === "pickup") ? "pickup" : "delivery",
          address: String(x.address ?? "").trim(),
          prio: !!x.prio,
          status: x.status ?? null,
          proof: x.proof ?? null,
          created_at: x.created_at ?? null,
          updated_at: x.updated_at ?? null,
        }))
        .filter(s => s.address);
    }

    // Fallback
    const out = [];
    if (sh.pickup_address) out.push({ stop_index: 0, type:"pickup", address: String(sh.pickup_address).trim(), prio: !!sh.pickup_prio, status:null, proof:null });
    if (sh.delivery_address) out.push({ stop_index: 1, type:"delivery", address: String(sh.delivery_address).trim(), prio: !!sh.delivery_prio, status:null, proof:null });
    return out;
  }

  async function ensureClient() {
    if (!window.supabaseClient) throw new Error("supabaseClient ontbreekt");
    return window.supabaseClient;
  }

  function renderShipmentCard(sh, stops) {
    const pickupStops = (stops || []).filter(s => s.type === "pickup");
    const deliveryStops = (stops || []).filter(s => s.type === "delivery");

    const listHtml = (arr) => {
      if (!arr.length) return `<div class="muted">—</div>`;
      return arr.map((s, i) => {
        const prefix = arr.length > 1 ? `${i + 1}. ` : "";
        return `<div style="margin-top:6px;">${esc(prefix + s.address)}</div>`;
      }).join("");
    };

    // “Witruimte” zoals je schets: alleen marge tussen klant en adressen
    const addressesBlock = `
      <div style="margin-top:10px;">
        <div style="font-weight:800;">Ophaaladres${pickupStops.length > 1 ? "sen" : ""}</div>
        <div style="margin-top:6px;">${listHtml(pickupStops)}</div>

        <div style="height:12px;"></div>

        <div style="font-weight:800;">Bezorgadres${deliveryStops.length > 1 ? "sen" : ""}</div>
        <div style="margin-top:6px;">${listHtml(deliveryStops)}</div>
      </div>
    `;

    shipmentCard.innerHTML = `
      <div style="font-weight:800;font-size:16px;">
        ${esc(displayTrackCode(sh.track_code))}
      </div>

      <div style="margin-top:6px;">
        <b>Klant:</b> ${esc(sh.customer_name || "-")}
      </div>

      ${addressesBlock}

      <div class="muted" style="margin-top:10px;">
        Type: ${esc(sh.type || "-")} • Colli: ${esc(sh.colli ?? sh.colli_count ?? "-")}
      </div>

      <div class="status-badge" style="margin-top:8px;">
        ${esc(labelStatus(sh.status))}
      </div>
    `;
  }

  function renderStopsCard(stops, sh) {
    if (!stopsCard) return;
    const stopsSafe = Array.isArray(stops) ? stops : [];

    // Je wilde stops niet per se in een aparte kaart. Als je hem leeg wil houden:
    stopsCard.innerHTML = "";

    // Als je 'm later toch wil tonen, zet dan hieronder je HTML terug.
  }

  function buildTimelineFromEvents(events) {
    const eventsSafe = Array.isArray(events) ? events : [];
    if (!eventsSafe.length) return "";

    return eventsSafe.map((e) => {
      const dt = fmtDateTimeNL(e.created_at);
      const nice = eventTypeToNice(e.event_type || e.status);
      const si = (e.stop_index === 0 || e.stop_index) ? ` (stop ${Number(e.stop_index) + 1})` : "";
      const note = e.note ? ` — ${esc(e.note)}` : "";
      return `<li><b>${esc(nice)}</b>${esc(si)}${dt ? ` • <span class="muted">${esc(dt)}</span>` : ""}${note}</li>`;
    }).join("");
  }

  function buildTimelineFromStops(stops) {
    const stopsSafe = Array.isArray(stops) ? stops : [];
    if (!stopsSafe.length) return `<li class="muted">Nog geen tijdpad.</li>`;

    return stopsSafe.map((st, i) => {
      const type = st.type === "pickup" ? "Ophalen" : "Bezorgen";
      const statusTxt = labelStatus(st.status || "Onbekend");
      return `<li>${i + 1}. ${esc(type)}: ${esc(st.address)} — <b>${esc(statusTxt)}</b></li>`;
    }).join("");
  }

  function renderTimeline(events, stops) {
    if (!eventsCard) return;

    let items = buildTimelineFromEvents(events);
    if (!items) items = buildTimelineFromStops(stops);

    eventsCard.innerHTML = `
      <div style="font-weight:800;">Tijdpad</div>
      <ul style="margin:8px 0 0 18px;">
        ${items}
      </ul>
    `;
  }

  async function load() {
    const code = qParam("code");
    if (!code) {
      if (subLine) subLine.textContent = "Geen code meegegeven (?code=DVK...)";
      return;
    }

    // Alleen "laden..." (geen "Code: ...")
    if (subLine) subLine.textContent = "Laden…";

    const supabaseClient = await ensureClient();

    // Shipment ophalen
    const { data: sh, error } = await supabaseClient
      .from("shipments")
      .select("*, stops")
      .eq("track_code", code)
      .single();

    if (error || !sh) {
      if (subLine) subLine.textContent = "";
      shipmentCard.innerHTML = `<b>Niet gevonden</b><div class="muted">Controleer de code.</div>`;
      if (stopsCard) stopsCard.innerHTML = "";
      if (eventsCard) eventsCard.innerHTML = "";
      return;
    }

    const stops = normalizeStops(sh);

    // Events ophalen (tijdpad met datum/tijd)
    let events = [];
    try {
      const evRes = await supabaseClient
        .from("shipment_events")
        .select("event_type, note, stop_index, created_at")
        .eq("shipment_id", sh.id)
        .order("created_at", { ascending: true });

      if (!evRes.error && Array.isArray(evRes.data)) {
        events = evRes.data;
      }
    } catch {
      // stil falen, we hebben fallback op stops
    }

    // Render
    if (subLine) subLine.textContent = ""; // helemaal leeg

    renderShipmentCard(sh, stops);
    renderStopsCard(stops, sh);
    renderTimeline(events, stops);

    // PDF knop (veilig)
    if (btnPdf) {
      btnPdf.onclick = () => makePdf(sh, stops, events || []);
    }
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
    doc.text("Track & Trace", 40, y); y += 22;

    line(`Trackcode: ${displayTrackCode(sh.track_code)}`, true);
    line(`Klant: ${sh.customer_name || "-"}`);
    line(`Type: ${sh.type || "-"} • Colli: ${sh.colli ?? sh.colli_count ?? "-"}`);
    line(`Status: ${labelStatus(sh.status)}`);

    y += 10;
    line("Adressen:", true);
    (stops || []).forEach((s, idx) => {
      const tag = s.type === "pickup" ? "Ophalen" : "Bezorgen";
      line(`${idx + 1}. ${tag}: ${s.address} ${s.prio ? "(PRIO)" : ""} — ${labelStatus(s.status || "Onbekend")}`);
    });

    y += 10;
    line("Tijdpad:", true);
    if (Array.isArray(events) && events.length) {
      events.forEach((e) => {
        const t = fmtDateTimeNL(e.created_at);
        const si = (e.stop_index === 0 || e.stop_index) ? ` (stop ${Number(e.stop_index) + 1})` : "";
        line(`${eventTypeToNice(e.event_type)}${si}${t ? ` • ${t}` : ""}${e.note ? ` • ${e.note}` : ""}`);
      });
    } else {
      line("Nog geen events. Tijdpad gebaseerd op stops.");
    }

    doc.save(`Track-${displayTrackCode(sh.track_code)}.pdf`);
  }

  btnRefresh?.addEventListener("click", load);
  load();
})();
