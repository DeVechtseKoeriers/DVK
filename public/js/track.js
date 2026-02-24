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
      // GEARCHIVEERD bewust NIET tonen
    };
    return map[String(st || "").toUpperCase()] || (st || "Onbekend");
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
          prio: !!(x.prio ?? x.priority ?? x.is_prio ?? x.is_priority),
          status: x.status ?? null,
          proof: x.proof ?? null,
          picked_up_at: x.picked_up_at ?? null,
        }))
        .filter(s => s.address);
    }

    // Fallback legacy
    const out = [];
    if (sh.pickup_address) out.push({
      stop_index: 0,
      type: "pickup",
      address: String(sh.pickup_address).trim(),
      prio: !!sh.pickup_prio,
      status: null,
      proof: null,
      picked_up_at: null
    });
    if (sh.delivery_address) out.push({
      stop_index: 1,
      type: "delivery",
      address: String(sh.delivery_address).trim(),
      prio: !!sh.delivery_prio,
      status: null,
      proof: null,
      picked_up_at: null
    });
    return out;
  }

  function shipmentTypeNice(sh) {
    if (String(sh?.shipment_type || "").toLowerCase() === "overig") {
      return sh?.shipment_type_other ? String(sh.shipment_type_other) : "Overig";
    }
    return sh?.shipment_type ? String(sh.shipment_type) : "-";
  }

  function shipmentColliNice(sh) {
    const v = sh?.colli_count ?? sh?.colli ?? sh?.colliCount ?? sh?.colli_count;
    return (v === 0 || v) ? String(v) : "-";
  }

  async function ensureClient() {
    if (!window.supabaseClient) throw new Error("supabaseClient ontbreekt");
    return window.supabaseClient;
  }

  // --------- helpers voor tijdpad (stops-volgorde, met juiste tijden)
  function buildBestTimeForStop(st, events, i) {
    // 1) pickup: picked_up_at
    if (st.type === "pickup" && st.picked_up_at) return st.picked_up_at;

    // 2) delivery: proof.delivered_at
    if (st.type === "delivery" && st.proof?.delivered_at) return st.proof.delivered_at;

    // 3) fallback: events op stop_index (laatste event voor die stop)
    const si = Number(st.stop_index ?? i);
    const evs = Array.isArray(events) ? events : [];
    let best = null;

    for (const ev of evs) {
      if (ev.stop_index === null || ev.stop_index === undefined) continue;
      if (Number(ev.stop_index) !== si) continue;
      if (!ev.created_at) continue;
      // events komen al ascending binnen; we nemen de laatste die we tegenkomen
      best = ev.created_at;
    }
    return best;
  }

  function isArchivedStatus(status) {
    const up = String(status || "").toUpperCase();
    return up === "GEARCHIVEERD" || up === "GEARCHIVEERD" || up === "ARCHIVED";
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

    const addressesBlock = `
      <div style="margin-top:10px;">
        <div style="font-weight:800;">Ophaaladres${pickupStops.length > 1 ? "sen" : ""}</div>
        <div style="margin-top:6px;">${listHtml(pickupStops)}</div>

        <div style="height:12px;"></div>

        <div style="font-weight:800;">Bezorgadres${deliveryStops.length > 1 ? "sen" : ""}</div>
        <div style="margin-top:6px;">${listHtml(deliveryStops)}</div>
      </div>
    `;

    // ✅ status badge: NIET tonen als gearchiveerd
    const statusBadgeHtml = isArchivedStatus(sh.status)
      ? ""
      : `<div class="status-badge" style="margin-top:8px;">${esc(labelStatus(sh.status))}</div>`;

    shipmentCard.innerHTML = `
      <div style="font-weight:800;font-size:16px;">
        ${esc(displayTrackCode(sh.track_code))}
      </div>

      <div style="margin-top:6px;">
        <b>Klant:</b> ${esc(sh.customer_name || "-")}
      </div>

      ${addressesBlock}

      <div class="muted" style="margin-top:10px;">
        Type: ${esc(shipmentTypeNice(sh))} • Colli: ${esc(shipmentColliNice(sh))}
      </div>

      ${statusBadgeHtml}
    `;
  }

  function renderStopsCard(stops, sh) {
    if (!stopsCard) return;
    // jij wil ‘m leeg houden: prima
    stopsCard.innerHTML = "";
  }

  function buildTimelinePerStopWithTime(stops, events) {
    const stopsSafe = Array.isArray(stops) ? stops : [];
    const eventsSafe = Array.isArray(events) ? events : [];

    if (!stopsSafe.length) return `<li class="muted">Nog geen tijdpad.</li>`;

    return stopsSafe.map((st, i) => {
      const typeLabel = st.type === "pickup" ? "Ophalen" : "Bezorgen";
      const whenIso = buildBestTimeForStop(st, eventsSafe, i);
      const whenTxt = whenIso ? fmtDateTimeNL(whenIso) : "—";

      // status tonen (maar als null -> —)
      const statusUpper = String(st.status || "").toUpperCase();
      const statusTxt = st.status ? labelStatus(statusUpper) : "—";

      // probleem note (liefst uit proof/note, anders uit event note)
      let extraNote = "";
      if (statusUpper === "PROBLEEM") {
        // probeer een event note voor deze stop
        const si = Number(st.stop_index ?? i);
        const evNote = eventsSafe.findLast
          ? (eventsSafe.findLast(ev => Number(ev.stop_index) === si && ev.note) || null)
          : null;

        const n = (evNote?.note) || "";
        if (n) extraNote = ` — ${esc(n)}`;
      }

      // ✅ jouw gewenste format:
      // Ophalen: (adres) datum/tijd ophalen
      // Bezorgen: (adres) datum/tijd bezorgen
      return `<li>${i + 1}. ${esc(typeLabel)}: ${esc(st.address)} • <span class="muted">${esc(whenTxt)}</span></li>`;
    }).join("");
  }

  function renderTimeline(events, stops) {
    if (!eventsCard) return;

    const items = buildTimelinePerStopWithTime(stops, events);

    eventsCard.innerHTML = `
      <div style="font-weight:800;">Tijdpad</div>
      <ul style="margin:8px 0 0 18px;">
        ${items}
      </ul>

      <div class="muted" style="margin-top:12px;">
        Afleverbon na bezorging op te vragen bij De Vechtse Koeriers via
        <b>info@devechtsekoeriers.nl</b>
      </div>
    `;
  }

  async function load() {
    const code = qParam("code");
    if (!code) {
      return;
    }

    if (subLine) subLine.textContent = "Laden…";

    const supabaseClient = await ensureClient();

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

    stops = normalizeStops(sh);

// 🔥 Sorteer op route_rank als die bestaat (zoals chauffeur routeplanner)
stops.sort((a, b) => {
  const ra = (a.route_rank === 0 || a.route_rank) ? Number(a.route_rank) : 9999;
  const rb = (b.route_rank === 0 || b.route_rank) ? Number(b.route_rank) : 9999;
  return ra - rb;
});

    // Events ophalen (alleen als fallback voor tijd)
    let events = [];
    try {
      const { data: evData, error: evErr } = await supabaseClient
        .from("shipment_events")
        .select("event_type, note, stop_index, created_at")
        .eq("shipment_id", sh.id)
        .order("created_at", { ascending: true });

      if (!evErr && Array.isArray(evData)) events = evData;
    } catch {
      // stil falen
    }

    if (subLine) subLine.textContent = "";

    renderShipmentCard(sh, stops);
    renderStopsCard(stops, sh);
    renderTimeline(events, stops);

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
    const line = (txt, bold = false) => {
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
    line(`Type: ${shipmentTypeNice(sh)} • Colli: ${shipmentColliNice(sh)}`);

    // ✅ status NIET printen als gearchiveerd
    if (!isArchivedStatus(sh.status)) {
      line(`Status: ${labelStatus(sh.status)}`);
    }

    y += 10;
    line("Adressen:", true);
    (stops || []).forEach((s, idx) => {
      const tag = s.type === "pickup" ? "Ophalen" : "Bezorgen";
      const pr = s.prio ? " (PRIO)" : "";
      line(`${idx + 1}. ${tag}: ${s.address}${pr}`);
    });

    y += 10;
    line("Tijdpad:", true);

    if (Array.isArray(stops) && stops.length) {
      stops.forEach((st, i) => {
        const tag = st.type === "pickup" ? "Ophalen" : "Bezorgen";
        const whenIso = buildBestTimeForStop(st, events, i);
        const whenTxt = whenIso ? fmtDateTimeNL(whenIso) : "—";
        line(`${i + 1}. ${tag}: ${st.address} • ${whenTxt}`);
      });
    } else {
      line("Nog geen stops beschikbaar.");
    }

    y += 14;
    line("Afleverbon na bezorging op te vragen via De Vechtse Koeriers via info@devechtsekoeriers.nl");

    doc.save(`Track-${displayTrackCode(sh.track_code)}.pdf`);
  }

  btnRefresh?.addEventListener("click", load);
  load();
})();
