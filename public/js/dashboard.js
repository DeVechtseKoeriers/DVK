/* DVK Driver Dashboard — Clean rebuild (syntax-safe)
   - Multi-stop create + edit
   - Per-stop status
   - Delivered modal for BOTH single and multi-stop (proof saved per stop when multi)
   - Routeplanner (Maps + DistanceMatrix)
   - Supabase shipments + shipment_events
*/

(() => {
  // ---------------- DOM
  const $ = (id) => document.getElementById(id);

  const listEl = $("list");
  const listArchivedEl = $("listArchived");
  const tabActive = $("tabActive");
  const tabArchived = $("tabArchived");

  // Create
  const createMsg = $("createMsg");
  const shipmentTypeEl = $("shipment_type");
  const otherWrap = $("otherWrap");
  const btnCreate = $("btnCreate");

  // Stops UI (create)
  const stopsWrap = $("stopsWrap");
  const btnAddPickup = $("btnAddPickup");
  const btnAddDelivery = $("btnAddDelivery");

  // Legacy fields fallback (if no stops UI)
  const legacyPickupInput = $("pickup_address");
  const legacyDeliveryInput = $("delivery_address");
  const legacyPickupPrio = $("pickup_prio");
  const legacyDeliveryPrio = $("delivery_prio");

  // Edit modal
  const editOverlay = $("editOverlay");
  const editShipmentInfo = $("editShipmentInfo");
  const editCustomer = $("editCustomer");
  const editType = $("editType");
  const editColli = $("editColli");
  const editOtherWrap = $("editOtherWrap");
  const editTypeOther = $("editTypeOther");
  const editError = $("editError");
  const editCancel = $("editCancel");
  const editSave = $("editSave");

  const editStopsWrap = $("editStopsWrap");
  const btnEditAddPickup = $("btnEditAddPickup");
  const btnEditAddDelivery = $("btnEditAddDelivery");

  // Delivered modal
  const overlay = $("modalOverlay");
  const modalShipmentInfo = $("modalShipmentInfo");
  const modalReceiver = $("modalReceiver");
  const modalNote = $("modalNote");
  const modalError = $("modalError");
  const modalCancel = $("modalCancel");
  const modalConfirm = $("modalConfirm");

  // Signature
  const sigCanvas = $("sigCanvas");
  const sigClear = $("sigClear");

  // Photos
  const photo1 = $("photo1");
  const photo2 = $("photo2");

  // Logout
  const logoutBtn = $("btnLogout");

  // Routeplanner
  const btnPlanRoute = $("btnPlanRoute");
  const autoRouteEl = $("autoRoute");
  const routeMsgEl = $("routeMsg");
  const routeListEl = $("routeList");
  const mapEl = $("map");
  const routeSummaryEl = $("routeSummary");

  // ---------------- STATE
  let currentTab = "active";
  let currentUserId = null;

  let currentDeliveryShipment = null;
  let currentDeliveryStopIndex = null; // <-- important for multi-stop delivered proof
  let currentEditShipment = null;

  let activeShipmentsCache = [];
  window.activeShipmentsCache = activeShipmentsCache;

  const BASE_ADDRESS = "Vecht en Gein 28, 1393 PZ Nigtevecht, Nederland";

  // ---------------- Helpers
  function msg(t) { if (createMsg) createMsg.textContent = t || ""; }
  function routeMsg(t) { if (routeMsgEl) routeMsgEl.textContent = t || ""; }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setTab(tab) {
    currentTab = tab;
    const isActive = tab === "active";
    if (listEl) listEl.style.display = isActive ? "block" : "none";
    if (listArchivedEl) listArchivedEl.style.display = isActive ? "none" : "block";
    if (tabActive) tabActive.disabled = isActive;
    if (tabArchived) tabArchived.disabled = !isActive;
  }

  if (tabActive) tabActive.addEventListener("click", () => setTab("active"));
  if (tabArchived) tabArchived.addEventListener("click", () => setTab("archived"));

   async function fetchShipmentEvents(shipmentId) {
  const supabaseClient = await ensureClient();
  const { data, error } = await supabaseClient
    .from("shipment_events")
    .select("created_at,event_type,note,stop_index")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("events load error:", error);
    return [];
  }
  return data || [];
}

function fmtDT(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("nl-NL");
  } catch {
    return iso || "";
  }
}

async function downloadAfleverPdf(shipment) {
  // jsPDF check
  const jspdf = window.jspdf?.jsPDF;
  if (!jspdf) {
    alert("jsPDF ontbreekt. Voeg jsPDF script toe aan dashboard.html.");
    return;
  }

  const doc = new jspdf();
  const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
  const events = await fetchShipmentEvents(shipment.id);

  let y = 12;
  const line = (t) => { doc.text(String(t || ""), 10, y); y += 7; };

  // Header
  doc.setFontSize(14);
  line(`Afleverbon - ${shipment.track_code || ""}`);
  doc.setFontSize(10);
  line(`Klant: ${shipment.customer_name || "-"}`);
  line(`Type: ${shipment.shipment_type === "overig" ? (shipment.shipment_type_other || "overig") : (shipment.shipment_type || "-")} • Colli: ${shipment.colli_count ?? "-"}`);
  line(`Status: ${shipment.status || "-"}`);
  y += 3;

  // Stops
  doc.setFontSize(12);
  line("Stops:");
  doc.setFontSize(10);

  stops.forEach((s, i) => {
    const tag = s.type === "pickup" ? "Ophalen" : "Bezorgen";
    const st = s.status || "-";
    line(`${i + 1}. ${tag} • ${s.address} • Status: ${st}${s.prio ? " • PRIO" : ""}`);
    if (s.proof?.receiver_name) line(`   Ontvanger: ${s.proof.receiver_name}`);
    if (s.proof?.delivered_at) line(`   Tijd: ${fmtDT(s.proof.delivered_at)}`);
    if (s.proof?.delivered_note) line(`   Opmerking: ${s.proof.delivered_note}`);
  });

  y += 3;

  // Tijdpad (events)
  doc.setFontSize(12);
  line("Tijdpad:");
  doc.setFontSize(10);

  if (!events.length) {
    line("Geen events gevonden.");
  } else {
    events.forEach((ev) => {
      const si = (typeof ev.stop_index === "number") ? ` (stop ${ev.stop_index + 1})` : "";
      const note = ev.note ? ` — ${ev.note}` : "";
      line(`${fmtDT(ev.created_at)} • ${ev.event_type}${si}${note}`);
      // simpele page-break
      if (y > 280) { doc.addPage(); y = 12; }
    });
  }

  doc.save(`Afleverbon-${shipment.track_code || shipment.id}.pdf`);
}

  // ---------------- Supabase
  async function ensureClient() {
    if (!window.supabaseClient) throw new Error("supabaseClient ontbreekt (controleer supabase-config.js)");
    return window.supabaseClient;
  }

  async function requireAuth() {
    const supabaseClient = await ensureClient();
    const { data } = await supabaseClient.auth.getSession();
    if (!data?.session) {
      window.location.href = "/DVK/driver/login.html";
      throw new Error("Niet ingelogd");
    }
    return data.session.user;
  }

  // ---------------- Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const supabaseClient = await ensureClient();
      await supabaseClient.auth.signOut();
      window.location.href = "/DVK/driver/login.html";
    });
  }

  // ---------------- Type "overig"
  function toggleCreateOther() {
    if (!shipmentTypeEl || !otherWrap) return;
    otherWrap.style.display = shipmentTypeEl.value === "overig" ? "block" : "none";
  }
  if (shipmentTypeEl && otherWrap) shipmentTypeEl.addEventListener("change", toggleCreateOther);

  // ---------------- Google Places attach
  function attachPlacesToInput(inputEl) {
    try {
      if (!inputEl) return;
      if (inputEl.dataset.placesAttached === "1") return;
      if (!window.google?.maps?.places) return;

      const ac = new google.maps.places.Autocomplete(inputEl, {
        fields: ["formatted_address", "geometry", "name"],
        types: ["geocode"],
      });

      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (place?.formatted_address) inputEl.value = place.formatted_address;
      });

      inputEl.dataset.placesAttached = "1";
    } catch (e) {
      console.warn("Places attach failed:", e);
    }
  }

  function initAutocomplete() {
    // create UI
    if (stopsWrap) {
      stopsWrap.querySelectorAll("input.stopAddress").forEach(attachPlacesToInput);
    } else {
      attachPlacesToInput(legacyPickupInput);
      attachPlacesToInput(legacyDeliveryInput);
    }
    // edit UI
    if (editStopsWrap) {
      editStopsWrap.querySelectorAll("input.editStopAddress").forEach(attachPlacesToInput);
    }
  }

  // ---------------- Stops UI (Create)
  function hasStopsUI() {
    return !!(stopsWrap && (btnAddPickup || btnAddDelivery));
  }

  function stopRowTemplate({ type = "pickup", address = "", prio = false } = {}) {
    const row = document.createElement("div");
    row.className = "stopRow";
    row.dataset.type = type;

    row.innerHTML = `
      <div class="stopLabel">${type === "pickup" ? "Ophaaladres" : "Bezorgadres"}</div>
      <input class="stopAddress" placeholder="Straat, huisnr, plaats" value="${escapeHtml(address)}" autocomplete="off" />
      <label class="prioLine">
        <input class="stopPrio" type="checkbox" ${prio ? "checked" : ""}/>
        <span>PRIO</span>
      </label>
      <button type="button" class="stopRemove" title="Verwijderen">×</button>
    `;

    row.querySelector(".stopRemove")?.addEventListener("click", () => {
      row.remove();
      window.__dvkMaybeAutoRecalcRoute?.();
    });

    return row;
  }

  function ensureDefaultStops() {
    if (!hasStopsUI()) return;
    if (stopsWrap.querySelectorAll(".stopRow").length > 0) return;

    stopsWrap.appendChild(stopRowTemplate({ type: "pickup" }));
    stopsWrap.appendChild(stopRowTemplate({ type: "delivery" }));

    if (window.__dvkMapsReady) initAutocomplete();
  }

  function addStop(type) {
    if (!stopsWrap) return;
    stopsWrap.appendChild(stopRowTemplate({ type }));
    if (window.__dvkMapsReady) initAutocomplete();
  }

  if (btnAddPickup) btnAddPickup.addEventListener("click", () => addStop("pickup"));
  if (btnAddDelivery) btnAddDelivery.addEventListener("click", () => addStop("delivery"));

  function getStopsFromCreateUI() {
    if (!hasStopsUI()) return null;
    const rows = [...stopsWrap.querySelectorAll(".stopRow")];

    return rows
      .map((r) => {
        const type = r.dataset.type === "delivery" ? "delivery" : "pickup";
        const address = r.querySelector(".stopAddress")?.value?.trim() || "";
        const prio = !!r.querySelector(".stopPrio")?.checked;
        return { type, address, prio, status: null };
      })
      .filter((s) => s.address);
  }

  function deriveLegacyFromStops(stops) {
    const pickups = stops.filter((s) => s.type === "pickup");
    const deliveries = stops.filter((s) => s.type === "delivery");

    const pickup_address = pickups[0]?.address || "";
    const delivery_address = deliveries[deliveries.length - 1]?.address || "";

    const pickup_prio = !!pickups[0]?.prio;
    const delivery_prio = !!deliveries[deliveries.length - 1]?.prio;

    return { pickup_address, delivery_address, pickup_prio, delivery_prio };
  }

  function normalizeStopsFromDb(shipment) {
    let raw = shipment?.stops;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }

    if (Array.isArray(raw) && raw.length) {
      return raw
        .map((x) => ({
          type: (x.type || x.stop_type || x.kind || "delivery") === "pickup" ? "pickup" : "delivery",
          address: String(x.address ?? x.addr ?? x.stop_address ?? "").trim(),
          prio: !!(x.prio ?? x.priority ?? x.is_prio ?? x.is_priority),
          status: x.status ?? null,
          proof: x.proof ?? null, // keep proof if exists
        }))
        .filter((s) => s.address);
    }

    // fallback legacy single fields
    const out = [];
    const p = String(shipment?.pickup_address || "").trim();
    const d = String(shipment?.delivery_address || "").trim();
    if (p) out.push({ type: "pickup", address: p, prio: shipment?.pickup_prio === true, status: null, proof: null });
    if (d) out.push({ type: "delivery", address: d, prio: shipment?.delivery_prio === true, status: null, proof: null });
    return out;
  }

  function isMultiStopShipment(shipment) {
    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    return stops.length > 2;
  }

  function computeOverallStatusFromStops(stops) {
    if (stops.some((s) => s.status === "PROBLEEM")) return "PROBLEEM";

    const pickups = stops.filter((s) => s.type === "pickup");
    const deliveries = stops.filter((s) => s.type === "delivery");

    const allPickupsDone = pickups.length
      ? pickups.every((s) => s.status === "OPGEHAALD" || s.status === "AFGELEVERD")
      : true;

    const allDeliveriesDone = deliveries.length
      ? deliveries.every((s) => s.status === "AFGELEVERD")
      : false;

    if (allPickupsDone && allDeliveriesDone) return "AFGELEVERD";
    if (stops.some((s) => s.status === "ONDERWEG")) return "ONDERWEG";
    if (stops.some((s) => s.status === "OPGEHAALD")) return "OPGEHAALD";
    return "AANGEMAAKT";
  }

  // ---------------- Events
  async function addEvent(shipmentId, eventType, note = null, stopIndex = null) {
    const supabaseClient = await ensureClient();
    const payload = { shipment_id: shipmentId, event_type: eventType, note };
    if (stopIndex !== null && stopIndex !== undefined) payload.stop_index = stopIndex;
    const { error } = await supabaseClient.from("shipment_events").insert(payload);
    if (error) console.warn("event insert error:", error);
  }

  // ---------------- Update shipment
  async function updateShipmentRow(shipmentId, patch) {
    const supabaseClient = await ensureClient();
    const { error } = await supabaseClient
      .from("shipments")
      .update(patch)
      .eq("id", shipmentId)
      .eq("driver_id", currentUserId);

    if (error) throw error;
  }

  async function updateStatus(shipment, newStatus, extra = {}, eventNote = null) {
    try {
      await updateShipmentRow(shipment.id, { status: newStatus, ...extra });
      try { await addEvent(shipment.id, newStatus, eventNote); } catch {}
      await loadShipments(currentUserId);
    } catch (e) {
      alert("Update fout: " + (e?.message || e));
    }
  }

  async function updateStopStatus(shipment, stopIndex, newStatus, noteForEvent = null) {
    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    if (!stops[stopIndex]) return;

    stops[stopIndex] = { ...stops[stopIndex], status: newStatus };

    const overall = computeOverallStatusFromStops(stops);
    const legacy = deriveLegacyFromStops(stops);

    await updateShipmentRow(shipment.id, {
      stops,
      status: overall,
      pickup_address: legacy.pickup_address,
      delivery_address: legacy.delivery_address,
      pickup_prio: legacy.pickup_prio,
      delivery_prio: legacy.delivery_prio,
    });

    // Event: write ONLY overall status, but include stop context in note
    const st = stops[stopIndex];
    const stopLabel = st ? `${st.type === "pickup" ? "Ophalen" : "Bezorgen"}: ${st.address}` : "";
    try { await addEvent(shipment.id, overall, noteForEvent || (stopLabel ? `Stop ${stopIndex + 1} • ${stopLabel}` : null), stopIndex); } catch {}

    await loadShipments(currentUserId);
  }

  // ---------------- Delete
  async function deleteShipment(shipment) {
    const ok = confirm(`Weet je zeker dat je zending ${shipment.track_code} wilt verwijderen?\n\nDit kan niet ongedaan gemaakt worden.`);
    if (!ok) return;

    const supabaseClient = await ensureClient();
    const { data, error } = await supabaseClient
      .from("shipments")
      .delete()
      .eq("id", shipment.id)
      .eq("driver_id", currentUserId)
      .select("id");

    if (error) { alert("Verwijderen mislukt: " + error.message); return; }
    if (!data || data.length === 0) { alert("Niet verwijderd (RLS/driver_id mismatch)."); return; }

    await loadShipments(currentUserId);
  }

  // ---------------- Delivered modal (signature + photos)
  let drawing = false;
  let hasSignature = false;
  let last = null;

  function setupCanvasForDPR() {
    if (!sigCanvas) return;
    const rect = sigCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sigCanvas.width = Math.round(rect.width * dpr);
    sigCanvas.height = Math.round(rect.height * dpr);
    const ctx = sigCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
  }

  function getPoint(e) {
    const rect = sigCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function sigReset() {
    if (!sigCanvas) return;
    const ctx = sigCanvas.getContext("2d");
    ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    hasSignature = false;
    last = null;
  }

  function onPointerDown(e) {
    drawing = true;
    sigCanvas.setPointerCapture(e.pointerId);
    last = getPoint(e);
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!drawing || !last) return;
    const ctx = sigCanvas.getContext("2d");
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    hasSignature = true;
    e.preventDefault();
  }
  function onPointerUp(e) {
    drawing = false;
    last = null;
    e.preventDefault();
  }

  if (sigCanvas) {
    sigCanvas.style.touchAction = "none";
    sigCanvas.addEventListener("pointerdown", onPointerDown);
    sigCanvas.addEventListener("pointermove", onPointerMove);
    sigCanvas.addEventListener("pointerup", onPointerUp);
    sigCanvas.addEventListener("pointercancel", onPointerUp);
  }
  if (sigClear) sigClear.addEventListener("click", sigReset);

  function openDeliveredModal(shipment, stopIndex = null) {
    currentDeliveryShipment = shipment;
    currentDeliveryStopIndex = (typeof stopIndex === "number") ? stopIndex : null;

    if (modalError) modalError.textContent = "";
    if (modalReceiver) modalReceiver.value = "";
    if (modalNote) modalNote.value = "";
    if (photo1) photo1.value = "";
    if (photo2) photo2.value = "";

    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);

    let headerLine = `${escapeHtml(shipment.pickup_address || "")} → ${escapeHtml(shipment.delivery_address || "")}`;
    if (stops.length) {
      const firstP = stops.find((x) => x.type === "pickup")?.address || shipment.pickup_address || "";
      const lastD = [...stops].reverse().find((x) => x.type === "delivery")?.address || shipment.delivery_address || "";
      headerLine = `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`;
    }

    // If multi-stop and stopIndex set, show which stop is being delivered
    let stopLine = "";
    if (typeof stopIndex === "number" && stops[stopIndex]) {
      const st = stops[stopIndex];
      stopLine = `<br/><span class="small"><b>Bevestiging voor:</b> Stop ${stopIndex + 1} • ${escapeHtml(st.type === "pickup" ? "Ophalen" : "Bezorgen")} • ${escapeHtml(st.address)}</span>`;
    }

    if (modalShipmentInfo) {
      modalShipmentInfo.innerHTML = `<b>${escapeHtml(shipment.track_code)}</b><br/>${headerLine}${stopLine}`;
    }

    if (overlay) overlay.style.display = "flex";
    setTimeout(() => {
      setupCanvasForDPR();
      sigReset();
      modalReceiver?.focus();
    }, 60);
  }

  function closeDeliveredModal() {
    if (overlay) overlay.style.display = "none";
    currentDeliveryShipment = null;
    currentDeliveryStopIndex = null;
  }

  if (modalCancel) modalCancel.addEventListener("click", closeDeliveredModal);
  if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDeliveredModal(); });

  // Supabase Storage upload helpers
  async function uploadFile(bucket, path, fileOrBlob, contentType) {
    const supabaseClient = await ensureClient();
    const { error } = await supabaseClient.storage
      .from(bucket)
      .upload(path, fileOrBlob, { upsert: true, contentType });
    if (error) throw error;
    return path;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1.0));
  }

  if (modalConfirm) {
    modalConfirm.addEventListener("click", async () => {
      if (!currentDeliveryShipment) return;

      const receiver = modalReceiver?.value?.trim() || "";
      const note = modalNote?.value?.trim() || null;

      if (!receiver) { if (modalError) modalError.textContent = "Naam ontvanger is verplicht."; modalReceiver?.focus(); return; }
      if (!hasSignature) { if (modalError) modalError.textContent = "Handtekening is verplicht."; return; }

      modalConfirm.disabled = true;
      if (modalError) modalError.textContent = "Uploaden...";

      try {
        const bucket = "dvk-delivery";
        const track = currentDeliveryShipment.track_code;
        const base = `${currentUserId}/${track}/${Date.now()}`;

        const sigBlob = await canvasToBlob(sigCanvas);
        const sigPath = `${base}/signature.png`;
        await uploadFile(bucket, sigPath, sigBlob, "image/png");

        let p1 = null, p2 = null;

        if (photo1?.files?.[0]) {
          const f = photo1.files[0];
          p1 = `${base}/photo1-${Date.now()}`;
          await uploadFile(bucket, p1, f, f.type || "image/jpeg");
        }
        if (photo2?.files?.[0]) {
          const f = photo2.files[0];
          p2 = `${base}/photo2-${Date.now()}`;
          await uploadFile(bucket, p2, f, f.type || "image/jpeg");
        }

        if (modalError) modalError.textContent = "Opslaan...";

        const proof = {
          receiver_name: receiver,
          delivered_note: note,
          signature_path: sigPath,
          photo1_path: p1,
          photo2_path: p2,
          delivered_at: new Date().toISOString(),
        };

        // Multi-stop delivered: save proof on THAT stop + update overall
        if (typeof currentDeliveryStopIndex === "number") {
          const shipment = currentDeliveryShipment;
          const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);

          if (!stops[currentDeliveryStopIndex]) throw new Error("Stop index mismatch.");

          stops[currentDeliveryStopIndex] = {
            ...stops[currentDeliveryStopIndex],
            status: "AFGELEVERD",
            proof,
          };

          const overall = computeOverallStatusFromStops(stops);
          const legacy = deriveLegacyFromStops(stops);

          await updateShipmentRow(shipment.id, {
            stops,
            status: overall,
            pickup_address: legacy.pickup_address,
            delivery_address: legacy.delivery_address,
            pickup_prio: legacy.pickup_prio,
            delivery_prio: legacy.delivery_prio,
          });

          const st = stops[currentDeliveryStopIndex];
          const stopLabel = `Stop ${currentDeliveryStopIndex + 1} • ${st.type === "pickup" ? "Ophalen" : "Bezorgen"}: ${st.address}`;
          try { await addEvent(shipment.id, overall, `AFGELEVERD • ${stopLabel}`, currentDeliveryStopIndex); } catch {}

          closeDeliveredModal();
          await loadShipments(currentUserId);
          return;
        }

        // Single/2-stop delivered (legacy): store on shipment columns
        await updateStatus(
          currentDeliveryShipment,
          "AFGELEVERD",
          {
            receiver_name: receiver,
            delivered_note: note,
            signature_path: sigPath,
            photo1_path: p1,
            photo2_path: p2,
          },
          note
        );

        closeDeliveredModal();
      } catch (err) {
        console.error(err);
        if (modalError) modalError.textContent = "Fout: " + (err?.message || err);
      } finally {
        modalConfirm.disabled = false;
      }
    });
  }

  // ---------------- Edit modal
  function toggleEditOther() {
    if (!editType || !editOtherWrap) return;
    editOtherWrap.style.display = editType.value === "overig" ? "block" : "none";
  }
  if (editType) editType.addEventListener("change", toggleEditOther);

  function addEditStopRow(type, address = "", prio = false) {
    if (!editStopsWrap) return;

    const row = document.createElement("div");
    row.className = "stopRow";
    row.dataset.type = type;

    row.innerHTML = `
      <div class="stopLabel">${type === "pickup" ? "Ophalen" : "Bezorgen"}</div>
      <input class="editStopAddress" placeholder="Straat, huisnr, plaats" value="${escapeHtml(address)}" autocomplete="off" />
      <label class="prioLine">
        <input class="editStopPrio" type="checkbox" ${prio ? "checked" : ""}/>
        <span>PRIO</span>
      </label>
      <button type="button" class="stopRemove">×</button>
    `;
    row.querySelector(".stopRemove")?.addEventListener("click", () => row.remove());
    editStopsWrap.appendChild(row);

    if (window.__dvkMapsReady) attachPlacesToInput(row.querySelector(".editStopAddress"));
  }

  function getStopsFromEditUI() {
    if (!editStopsWrap) return [];
    const rows = [...editStopsWrap.querySelectorAll(".stopRow")];
    return rows
      .map((r) => ({
        type: r.dataset.type === "pickup" ? "pickup" : "delivery",
        address: (r.querySelector(".editStopAddress")?.value || "").trim(),
        prio: !!r.querySelector(".editStopPrio")?.checked,
      }))
      .filter((s) => s.address);
  }

  function openEditModal(shipment) {
    currentEditShipment = shipment;
    if (editError) editError.textContent = "";

    if (editShipmentInfo) {
      editShipmentInfo.innerHTML = `<b>${escapeHtml(shipment.track_code || "")}</b><br/><span class="small">${escapeHtml(shipment.customer_name || "")}</span>`;
    }

    if (editCustomer) editCustomer.value = shipment.customer_name || "";
    if (editType) editType.value = shipment.shipment_type || "doos";
    if (editColli) editColli.value = String(shipment.colli_count ?? 1);
    if (editTypeOther) editTypeOther.value = shipment.shipment_type_other || "";

    toggleEditOther();

    if (editStopsWrap) editStopsWrap.innerHTML = "";
    const oldStops = normalizeStopsFromDb(shipment);
    if (oldStops.length) oldStops.forEach((st) => addEditStopRow(st.type, st.address, st.prio));
    else {
      addEditStopRow("pickup", shipment.pickup_address || "", false);
      addEditStopRow("delivery", shipment.delivery_address || "", false);
    }

    if (btnEditAddPickup) btnEditAddPickup.onclick = () => addEditStopRow("pickup");
    if (btnEditAddDelivery) btnEditAddDelivery.onclick = () => addEditStopRow("delivery");

    if (editOverlay) editOverlay.style.display = "flex";
    setTimeout(() => editCustomer?.focus(), 50);
  }

  function closeEditModal() {
    if (editOverlay) editOverlay.style.display = "none";
    currentEditShipment = null;
  }

  if (editCancel) editCancel.addEventListener("click", closeEditModal);
  if (editOverlay) editOverlay.addEventListener("click", (e) => { if (e.target === editOverlay) closeEditModal(); });

  async function saveEditShipment() {
    if (!currentEditShipment) return;

    const customer_name = editCustomer?.value?.trim() || "";
    const shipment_type = editType?.value || "doos";
    const shipment_type_other = editTypeOther?.value?.trim() || null;
    const colli_count = parseInt(editColli?.value || "1", 10);

    const editedStops = getStopsFromEditUI();
    const hasPickup = editedStops.some((s) => s.type === "pickup" && s.address);
    const hasDelivery = editedStops.some((s) => s.type === "delivery" && s.address);

    if (!customer_name || !hasPickup || !hasDelivery) {
      if (editError) editError.textContent = "Vul klantnaam + minimaal 1 ophaaladres + minimaal 1 bezorgadres in.";
      return;
    }
    if (shipment_type === "overig" && !shipment_type_other) {
      if (editError) editError.textContent = "Vul bij 'overig' een type in.";
      return;
    }

    if (editSave) editSave.disabled = true;
    if (editError) editError.textContent = "Opslaan...";

    try {
      // Preserve old stop statuses + proof by matching index
      const oldStops = normalizeStopsFromDb(currentEditShipment);
      const mergedStops = editedStops.map((s, i) => ({
        ...s,
        status: oldStops[i]?.status ?? null,
        proof: oldStops[i]?.proof ?? null,
      }));

      const legacy = deriveLegacyFromStops(mergedStops);
      const overall = mergedStops.length > 2
        ? computeOverallStatusFromStops(mergedStops)
        : (currentEditShipment.status || "AANGEMAAKT");

      await updateShipmentRow(currentEditShipment.id, {
        customer_name,
        shipment_type,
        shipment_type_other: shipment_type === "overig" ? shipment_type_other : null,
        colli_count: Number.isFinite(colli_count) ? colli_count : 1,
        stops: mergedStops,
        pickup_address: legacy.pickup_address,
        delivery_address: legacy.delivery_address,
        pickup_prio: legacy.pickup_prio,
        delivery_prio: legacy.delivery_prio,
        status: overall,
      });

      if (editError) editError.textContent = "";
      closeEditModal();
      await loadShipments(currentUserId);
    } catch (e) {
      console.error(e);
      if (editError) editError.textContent = "Fout: " + (e?.message || e);
    } finally {
      if (editSave) editSave.disabled = false;
    }
  }
  if (editSave) editSave.addEventListener("click", saveEditShipment);

  // ---------------- Create shipment
  function generateTrackcode() {
    return `DVK${new Date().getFullYear()}${Math.floor(Date.now() / 1000)}`;
  }

  async function createShipment() {
    msg("Bezig...");

    const customer_name = $("customer_name")?.value?.trim() || "";
    const shipment_type = $("shipment_type")?.value || "doos";
    const shipment_type_other = $("shipment_type_other")?.value?.trim() || null;
    const colli_count = parseInt($("colli_count")?.value || "1", 10);

    if (!customer_name) { msg("Vul klantnaam in."); return; }
    if (shipment_type === "overig" && !shipment_type_other) { msg("Vul bij 'overig' een type in."); return; }

    let stops = null;

    if (hasStopsUI()) {
      stops = getStopsFromCreateUI() || [];
    } else {
      const pickup_address = legacyPickupInput?.value?.trim() || "";
      const delivery_address = legacyDeliveryInput?.value?.trim() || "";
      const pickup_prio = !!legacyPickupPrio?.checked;
      const delivery_prio = !!legacyDeliveryPrio?.checked;

      stops = [
        { type: "pickup", address: pickup_address, prio: pickup_prio, status: null, proof: null },
        { type: "delivery", address: delivery_address, prio: delivery_prio, status: null, proof: null },
      ].filter((s) => s.address);
    }

    const hasPickup = stops.some((s) => s.type === "pickup" && s.address);
    const hasDelivery = stops.some((s) => s.type === "delivery" && s.address);
    if (!hasPickup || !hasDelivery) { msg("Voeg minimaal 1 ophaaladres én 1 bezorgadres toe."); return; }

    const legacy = deriveLegacyFromStops(stops);
    const track_code = generateTrackcode();

    const baseInsert = {
      driver_id: currentUserId,
      track_code,
      customer_name,
      pickup_address: legacy.pickup_address,
      delivery_address: legacy.delivery_address,
      pickup_prio: legacy.pickup_prio,
      delivery_prio: legacy.delivery_prio,
      shipment_type,
      shipment_type_other: shipment_type === "overig" ? shipment_type_other : null,
      colli_count: Number.isFinite(colli_count) ? colli_count : 1,
      status: "AANGEMAAKT",
      stops,
    };

    try {
      const supabaseClient = await ensureClient();
      const r = await supabaseClient.from("shipments").insert(baseInsert).select("id, track_code").single();
      if (r.error) { msg("Fout: " + r.error.message); return; }

      // Event "AANGEMAAKT" ONLY HERE (avoids double)
      try { await addEvent(r.data.id, "AANGEMAAKT", null); } catch {}

      msg(`Aangemaakt: ${r.data.track_code}`);

      // reset form
      $("customer_name").value = "";
      $("colli_count").value = "1";
      $("shipment_type").value = "doos";
      if ($("shipment_type_other")) $("shipment_type_other").value = "";
      toggleCreateOther();

      if (hasStopsUI()) {
        stopsWrap.innerHTML = "";
        ensureDefaultStops();
      } else {
        if (legacyPickupInput) legacyPickupInput.value = "";
        if (legacyDeliveryInput) legacyDeliveryInput.value = "";
        if (legacyPickupPrio) legacyPickupPrio.checked = false;
        if (legacyDeliveryPrio) legacyDeliveryPrio.checked = false;
      }

      await loadShipments(currentUserId);
    } catch (e) {
      console.error(e);
      msg("Fout: " + (e?.message || e));
    }
  }

  if (btnCreate) btnCreate.addEventListener("click", (e) => { e.preventDefault(); createShipment(); });

  // ---------------- Render shipment cards
  function mkBtn(text, onClick, className = "") {
  const b = document.createElement("button");
  b.textContent = text;
  if (className) b.className = className;
  b.addEventListener("click", onClick);
  return b;
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

  function renderStopStatusUI(shipment) {
    const wrap = document.createElement("div");
    wrap.className = "stopStatusWrap";

    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    if (stops.length <= 2) return wrap;

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.margin = "6px 0";
    title.textContent = "Status per adres:";
    wrap.appendChild(title);

    stops.forEach((st, idx) => {
      const row = document.createElement("div");
      row.className = "stopStatusRow";

      const tag = st.type === "pickup" ? "Ophalen" : "Bezorgen";
      const cur = st.status ? labelStatus(st.status) : "—";

      row.innerHTML = `
        <div class="small">
          <b>${idx + 1}. ${escapeHtml(tag)}:</b> ${escapeHtml(st.address)}
          ${st.prio ? ' <span style="color:#c00;font-weight:800;">PRIO</span>' : ""}
          <br/><span class="small">Huidig: <b>${escapeHtml(cur)}</b></span>
          ${st.proof?.receiver_name ? `<br/><span class="small"><b>Ontvanger:</b> ${escapeHtml(st.proof.receiver_name)}</span>` : ""}
        </div>
      `;

      const btns = document.createElement("div");
      btns.className = "stopStatusButtons";

      btns.appendChild(mkBtn("Opgehaald", () => updateStopStatus(shipment, idx, "OPGEHAALD"), `statusBtn ${st.status==="OPGEHAALD" ? "isActive" : ""}`));
btns.appendChild(mkBtn("Onderweg", () => updateStopStatus(shipment, idx, "ONDERWEG"), `statusBtn ${st.status==="ONDERWEG" ? "isActive" : ""}`));
btns.appendChild(mkBtn("Probleem", async () => {
  const note = prompt("Wat is het probleem?");
  if (!note) return;

  await updateStopStatus(shipment, idx, "PROBLEEM");

  try {
    await updateShipmentRow(shipment.id, { problem_note: note, status: "PROBLEEM" });
  } catch (e) {
    console.warn("problem_note update failed:", e);
  }

  await loadShipments(currentUserId);
}));

      // ✅ IMPORTANT: multi-stop delivered MUST open modal
      btns.appendChild(mkBtn("Afgeleverd", () => openDeliveredModal(shipment, idx)));

      row.appendChild(btns);
      wrap.appendChild(row);
    });

    return wrap;
  }

  function renderShipmentCard(s) {
    const div = document.createElement("div");
    div.className = "shipment";

    const stops = s._stopsNorm || normalizeStopsFromDb(s);
    const firstP = stops.find((x) => x.type === "pickup")?.address || s.pickup_address || "";
    const lastD = [...stops].reverse().find((x) => x.type === "delivery")?.address || s.delivery_address || "";
    const line = stops.length
      ? `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`
      : `${escapeHtml(s.pickup_address || "")} → ${escapeHtml(s.delivery_address || "")}`;

    const typeText =
      s.shipment_type === "overig" ? (s.shipment_type_other || "overig") : (s.shipment_type || "");

    const trackLink = `/DVK/track/?code=${encodeURIComponent(s.track_code)}`;

    div.innerHTML = `
      <div>
        <strong>${escapeHtml(s.track_code)}</strong> — ${escapeHtml(s.customer_name)}<br/>
        <small>${line}</small><br/>
        <small>Type: ${escapeHtml(typeText)} • Colli: ${s.colli_count ?? ""} • Status: <b>${escapeHtml(s.status || "")}</b></small><br/>
        <small>Track & Trace: <a href="${trackLink}" target="_blank">${trackLink}</a></small>
        <div class="actions"></div>
        <div class="sub"></div>
      </div>
    `;

    const actions = div.querySelector(".actions");
    const sub = div.querySelector(".sub");

    actions.appendChild(mkBtn("Verwijderen", () => deleteShipment(s)));
    actions.appendChild(mkBtn("Aflever-PDF", () => downloadAfleverPdf(s))); 

    if (!s.archived_at) {
      actions.appendChild(mkBtn("Wijzigen", () => openEditModal(s)));

      if (!isMultiStopShipment(s)) {
        actions.appendChild(mkBtn("Opgehaald", () => updateStatus(s, "OPGEHAALD"), `statusBtn ${s.status==="OPGEHAALD" ? "isActive" : ""}`));
        actions.appendChild(mkBtn("Onderweg", () => updateStatus(s, "ONDERWEG"), `statusBtn ${s.status==="ONDERWEG" ? "isActive" : ""}`));
        actions.appendChild(mkBtn("Probleem", async () => {
        const note = prompt("Wat is het probleem?");
        if (!note) return;
        await updateStatus(s, "PROBLEEM", { problem_note: note }, note);
        }, `statusBtn ${s.status==="PROBLEEM" ? "isActive" : ""}`));
        actions.appendChild(mkBtn("Afgeleverd", () => openDeliveredModal(s, null), `statusBtn ${s.status==="AFGELEVERD" ? "isActive" : ""}`));
      } else {
        div.appendChild(renderStopStatusUI(s));
      }

      if (s.status === "AFGELEVERD") {
        actions.appendChild(mkBtn("Archiveer", () => updateStatus(s, "GEARCHIVEERD", { archived_at: new Date().toISOString() })));
      }
    }

    if (s.problem_note) sub.innerHTML = `<small><b>Probleem:</b> ${escapeHtml(s.problem_note)}</small>`;
    if (s.receiver_name) sub.innerHTML += `${sub.innerHTML ? "<br/>" : ""}<small><b>Ontvanger:</b> ${escapeHtml(s.receiver_name)}</small>`;
    if (s.signature_path) sub.innerHTML += `${sub.innerHTML ? "<br/>" : ""}<small><b>Handtekening:</b> opgeslagen ✅</small>`;
    if (s.photo1_path || s.photo2_path) sub.innerHTML += `${sub.innerHTML ? "<br/>" : ""}<small><b>Foto’s:</b> opgeslagen ✅</small>`;

    return div;
  }

  // ---------------- Load shipments
  async function loadShipments(driverId) {
    const supabaseClient = await ensureClient();

    if (listEl) listEl.innerHTML = "Laden...";
    if (listArchivedEl) listArchivedEl.innerHTML = "";

    const { data, error } = await supabaseClient
      .from("shipments")
      .select("*, stops")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      if (listEl) listEl.innerHTML = "Fout: " + error.message;
      return;
    }

    const all = (data || []).map((s) => {
      s._stopsNorm = normalizeStopsFromDb(s);
      const legacy = deriveLegacyFromStops(s._stopsNorm);
      if (!s.pickup_address && legacy.pickup_address) s.pickup_address = legacy.pickup_address;
      if (!s.delivery_address && legacy.delivery_address) s.delivery_address = legacy.delivery_address;
      return s;
    });

    const archived = all.filter((s) => !!s.archived_at || s.status === "GEARCHIVEERD");
    const active = all.filter((s) => !s.archived_at && s.status !== "GEARCHIVEERD");

    activeShipmentsCache = active.filter((s) => s.status !== "AFGELEVERD");
    window.activeShipmentsCache = activeShipmentsCache;

    if (listEl) listEl.innerHTML = "";
    if (listArchivedEl) listArchivedEl.innerHTML = "";

    if (!active.length) {
      if (listEl) listEl.innerHTML = "<small>Geen actieve zendingen.</small>";
    } else {
      active.forEach((s) => listEl.appendChild(renderShipmentCard(s)));
    }

    if (!archived.length) {
      if (listArchivedEl) listArchivedEl.innerHTML = "<small>Geen gearchiveerde zendingen.</small>";
    } else {
      archived.forEach((s) => listArchivedEl.appendChild(renderShipmentCard(s)));
    }

    if (autoRouteEl?.checked && window.__dvkMapsReady) window.__dvkMaybeAutoRecalcRoute?.();
  }

  // ---------------- Routeplanner + Maps
  let map = null;
  let directionsService = null;
  let directionsRenderer = null;

  function ensureMapsReady() {
    if (!window.google?.maps) throw new Error("Google Maps API niet geladen.");
  }

  function ensureMapInit() {
    ensureMapsReady();
    if (!map && mapEl) {
      map = new google.maps.Map(mapEl, {
        zoom: 9,
        center: { lat: 52.27, lng: 5.07 },
        mapTypeControl: true,
      });
    }
    if (!directionsService) directionsService = new google.maps.DirectionsService();
    if (!directionsRenderer && map) directionsRenderer = new google.maps.DirectionsRenderer({ map, suppressMarkers: false });
  }

  function clearRouteList() { if (routeListEl) routeListEl.innerHTML = ""; }

  function renderRouteList(stops) {
    if (!routeListEl) return;
    routeListEl.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";
    title.textContent = "Optimale volgorde:";
    routeListEl.appendChild(title);

    stops.forEach((s, i) => {
      const row = document.createElement("div");
      const prio = s.prio ? ' <span style="color:#c00;font-weight:800;">PRIO</span>' : "";
      row.innerHTML = `${i + 1}. ${escapeHtml(s.label)}${prio}`;
      routeListEl.appendChild(row);
    });
  }

  function buildStopsFromActiveShipments() {
    const out = [];
    for (const sh of (window.activeShipmentsCache || [])) {
      const stops = sh._stopsNorm || normalizeStopsFromDb(sh);
      if (!stops.length) continue;

      stops.forEach((st, idx) => {
        out.push({
          id: `${sh.id}_${idx}`,
          shipmentId: sh.id,
          type: st.type,
          address: st.address,
          prio: !!st.prio,
          label: `${st.type === "pickup" ? "Ophalen" : "Bezorgen"}: ${st.address} (${sh.track_code || ""})`,
        });
      });
    }
    return out;
  }

  async function buildTimeMatrix(addresses) {
    ensureMapsReady();
    const svc = new google.maps.DistanceMatrixService();
    return await new Promise((resolve, reject) => {
      svc.getDistanceMatrix(
        {
          origins: addresses,
          destinations: addresses,
          travelMode: google.maps.TravelMode.DRIVING,
          drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
          unitSystem: google.maps.UnitSystem.METRIC,
        },
        (res, status) => {
          if (status !== "OK" || !res) return reject(new Error("DistanceMatrix fout: " + status));
          resolve(res);
        }
      );
    });
  }

  function getDurationSeconds(matrix, i, j) {
    const el = matrix?.rows?.[i]?.elements?.[j];
    if (!el || el.status !== "OK") return Number.POSITIVE_INFINITY;
    return el.duration?.value ?? Number.POSITIVE_INFINITY;
  }

  async function computeOrderedStopsGreedy(stops) {
    if (!stops.length) return [];

    const addrs = [BASE_ADDRESS, ...stops.map((s) => s.address)];
    const matrix = await buildTimeMatrix(addrs);

    const pickupNeed = new Map();
    for (const s of stops) if (s.type === "pickup") pickupNeed.set(s.shipmentId, (pickupNeed.get(s.shipmentId) || 0) + 1);

    const donePickups = new Map();
    const remaining = new Map();
    stops.forEach((s) => remaining.set(s.id, s));

    let currentIndex = 0;
    const ordered = [];

    const idxOfStop = (stop) => 1 + stops.findIndex((x) => x.id === stop.id);

    while (remaining.size > 0) {
      const candidates = [];

      for (const s of remaining.values()) {
        if (s.type === "pickup") { candidates.push(s); continue; }
        const need = pickupNeed.get(s.shipmentId) || 0;
        const done = donePickups.get(s.shipmentId) || 0;
        if (need === 0 || done >= need) candidates.push(s);
      }
      if (!candidates.length) for (const s of remaining.values()) candidates.push(s);

      let best = null;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const c of candidates) {
        const cIndex = idxOfStop(c);
        let cost = getDurationSeconds(matrix, currentIndex, cIndex);
        if (c.prio) cost = cost * 0.35;
        if (cost < bestCost) { bestCost = cost; best = c; }
      }

      ordered.push(best);
      remaining.delete(best.id);

      if (best.type === "pickup") donePickups.set(best.shipmentId, (donePickups.get(best.shipmentId) || 0) + 1);
      currentIndex = idxOfStop(best);
    }

    if (ordered.length && ordered[ordered.length - 1].type !== "delivery") {
      const lastDeliveryIdx = [...ordered].map((s, i) => ({ s, i })).reverse().find((x) => x.s.type === "delivery")?.i;
      if (lastDeliveryIdx != null) ordered.push(ordered.splice(lastDeliveryIdx, 1)[0]);
    }

    return ordered;
  }

  async function drawRouteOnMap(orderedStops) {
    ensureMapInit();

    const waypoints = orderedStops.map((s) => ({ location: s.address, stopover: true }));

    const req = {
      origin: BASE_ADDRESS,
      destination: BASE_ADDRESS,
      waypoints,
      optimizeWaypoints: false,
      travelMode: google.maps.TravelMode.DRIVING,
    };

    return await new Promise((resolve, reject) => {
      directionsService.route(req, (res, status) => {
        if (status !== "OK" || !res) return reject(new Error("Directions fout: " + status));
        directionsRenderer.setDirections(res);
        resolve(res);
      });
    });
  }

  function setRouteSummaryFromDirections(res) {
    if (!routeSummaryEl) return;

    try {
      const legs = res?.routes?.[0]?.legs || [];
      let meters = 0;
      let seconds = 0;
      for (const leg of legs) { meters += leg?.distance?.value || 0; seconds += leg?.duration?.value || 0; }

      const km = (meters / 1000).toFixed(1);
      const h = Math.floor(seconds / 3600);
      const m = Math.round((seconds % 3600) / 60);
      const timeText = h > 0 ? `${h}u ${m}m` : `${m}m`;

      routeSummaryEl.innerHTML = `Totale afstand: ${km} km &nbsp;&nbsp;&nbsp; Totale reistijd: ${timeText}`;
    } catch {
      routeSummaryEl.innerHTML = `Totale afstand: – &nbsp;&nbsp;&nbsp; Totale reistijd: –`;
    }
  }

  async function planOptimalRoute() {
    try {
      routeMsg("Route berekenen...");
      clearRouteList();

      const stops = buildStopsFromActiveShipments();
      if (!stops.length) {
        routeMsg("Geen actieve zendingen voor routeplanning.");
        if (directionsRenderer) directionsRenderer.set("directions", null);
        if (routeSummaryEl) routeSummaryEl.innerHTML = `Totale afstand: – &nbsp;&nbsp;&nbsp; Totale reistijd: –`;
        return;
      }

      const ordered = await computeOrderedStopsGreedy(stops);
      renderRouteList(ordered);

      const res = await drawRouteOnMap(ordered);
      setRouteSummaryFromDirections(res);

      routeMsg(`Route klaar • ${ordered.length} stops • start/eind: Nigtevecht`);
    } catch (e) {
      console.error(e);
      routeMsg("Route fout: " + (e?.message || e));
    }
  }

  function maybeAutoRecalcRoute() {
    if (!autoRouteEl?.checked) return;
    if (!window.__dvkMapsReady) return;
    clearTimeout(window.__dvkRouteTimer);
    window.__dvkRouteTimer = setTimeout(() => planOptimalRoute(), 450);
  }
  window.__dvkMaybeAutoRecalcRoute = maybeAutoRecalcRoute;

  if (btnPlanRoute) btnPlanRoute.addEventListener("click", () => planOptimalRoute());

  // ✅ Google Maps callback (exactly once)
  window.initMaps = function () {
    try {
      window.__dvkMapsReady = true;
      ensureMapInit();
      initAutocomplete();
      if (autoRouteEl?.checked) planOptimalRoute();
    } catch (e) {
      console.error("initMaps error:", e);
    }
  };

 // ---------------- INIT (SCHOON & 1x)
(async () => {
  try {
    const user = await requireAuth();
    currentUserId = user.id;

    // Default stops UI (als aanwezig)
    if (typeof ensureDefaultStops === "function") {
      ensureDefaultStops();
    }

    setTab("active");
    await loadShipments(currentUserId);

    // Optional realtime refresh (veilig)
    try {
      const supabaseClient = await ensureClient();
      supabaseClient
        .channel("shipments_changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "shipments",
            filter: `driver_id=eq.${currentUserId}`,
          },
          () => loadShipments(currentUserId)
        )
        .subscribe();
    } catch (e) {
      console.warn("Realtime subscribe skipped:", e);
    }
  } catch (e) {
    console.error("INIT error:", e);
    msg("Init fout: " + (e?.message || e));
  }
})();

// ---------------- Google Maps callback (MOET 1x bestaan)
window.initMaps = function () {
  try {
    console.log("Google Maps geladen");
    window.__dvkMapsReady = true;

    ensureMapInit();
    initAutocomplete();

    if (autoRouteEl?.checked) planOptimalRoute();
  } catch (e) {
    console.error("initMaps error:", e);
  }

})();
