// DVK Driver Dashboard — STABLE SINGLE-FILE BUILD (v2)
// Implements requested changes:
// - Per-stop buttons:
//   * Pickup stop: only "Opgehaald" + "Probleem"
//   * Delivery stop: only "Afgeleverd" + "Probleem" (Afgeleverd opens proof modal per stop)
// - Multiple addresses: buttons per address
// - Auto-archive when ALL deliveries are AFGELEVERD
// - Archived tab: Aflever-PDF with logo + pickup/delivery addresses + times
// - Active button highlights green
// - PRIO checkbox per stop (already present) influences route planner priority
// - Track & Trace link stays smooth and correct
// - No duplicate initMaps, no parse errors

(() => {
  "use strict";

  // ---------------- CONFIG
  // Zet je logo hier neer (bijv. DVK/public/assets/logo.png)
  const LOGO_URL = "/DVK/assets/logo.png"; // als niet gevonden -> PDF gaat door zonder logo
  const BASE_ADDRESS = "Vecht en Gein 28, 1393 PZ Nigtevecht, Nederland";

  // ---------------- DOM
  const listEl = document.getElementById("list");
  const listArchivedEl = document.getElementById("listArchived");
  const tabActive = document.getElementById("tabActive");
  const tabArchived = document.getElementById("tabArchived");

  // Create form
  const createMsg = document.getElementById("createMsg");
  const shipmentTypeEl = document.getElementById("shipment_type");
  const otherWrap = document.getElementById("otherWrap");
  const btnCreate = document.getElementById("btnCreate");

  // Stops UI (create)
  const stopsWrap = document.getElementById("stopsWrap");
  const btnAddPickup = document.getElementById("btnAddPickup");
  const btnAddDelivery = document.getElementById("btnAddDelivery");

  // Legacy fields (if stops UI not present)
  const legacyPickupInput = document.getElementById("pickup_address");
  const legacyDeliveryInput = document.getElementById("delivery_address");
  const legacyPickupPrio = document.getElementById("pickup_prio");
  const legacyDeliveryPrio = document.getElementById("delivery_prio");

  // Edit modal
  const editOverlay = document.getElementById("editOverlay");
  const editShipmentInfo = document.getElementById("editShipmentInfo");
  const editCustomer = document.getElementById("editCustomer");
  const editType = document.getElementById("editType");
  const editColli = document.getElementById("editColli");
  const editOtherWrap = document.getElementById("editOtherWrap");
  const editTypeOther = document.getElementById("editTypeOther");
  const editError = document.getElementById("editError");
  const editCancel = document.getElementById("editCancel");
  const editSave = document.getElementById("editSave");

  // Edit stops UI
  const editStopsWrap = document.getElementById("editStopsWrap");
  const btnEditAddPickup = document.getElementById("btnEditAddPickup");
  const btnEditAddDelivery = document.getElementById("btnEditAddDelivery");

  // Delivered modal (proof)
  const overlay = document.getElementById("modalOverlay");
  const modalShipmentInfo = document.getElementById("modalShipmentInfo");
  const modalReceiver = document.getElementById("modalReceiver");
  const modalNote = document.getElementById("modalNote");
  const modalError = document.getElementById("modalError");
  const modalCancel = document.getElementById("modalCancel");
  const modalConfirm = document.getElementById("modalConfirm");

  // Signature
  const sigCanvas = document.getElementById("sigCanvas");
  const sigClear = document.getElementById("sigClear");

  // Photos
  const photo1 = document.getElementById("photo1");
  const photo2 = document.getElementById("photo2");

  // Logout
  const logoutBtn = document.getElementById("btnLogout");

  // Routeplanner
  const btnPlanRoute = document.getElementById("btnPlanRoute");
  const autoRouteEl = document.getElementById("autoRoute");
  const routeMsgEl = document.getElementById("routeMsg");
  const routeListEl = document.getElementById("routeList");
  const mapEl = document.getElementById("map");
  const routeSummaryEl = document.getElementById("routeSummary");

  // ---------------- STATE
  let currentTab = "active";
  let currentUserId = null;

  // For proof modal
  let currentDeliveryShipment = null;
  let currentDeliveryStopIndex = null; // delivery stop index for which we collect proof

  let currentEditShipment = null;

  let activeShipmentsCache = [];
  window.activeShipmentsCache = activeShipmentsCache;

  // ---------------- Helpers
  function msg(t) { if (createMsg) createMsg.textContent = t || ""; }
  function routeMsg(t) { if (routeMsgEl) routeMsgEl.textContent = t || ""; }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
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

  function hasStopsUI() {
    return !!(stopsWrap && (btnAddPickup || btnAddDelivery));
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
          proof: x.proof ?? null,
          picked_up_at: x.picked_up_at ?? null, // ✅ added for pickup time
        }))
        .filter((s) => s.address);
    }

    // fallback legacy
    const out = [];
    const p = String(shipment?.pickup_address || "").trim();
    const d = String(shipment?.delivery_address || "").trim();
    if (p) out.push({ type: "pickup", address: p, prio: shipment?.pickup_prio === true, status: null, proof: null, picked_up_at: null });
    if (d) out.push({ type: "delivery", address: d, prio: shipment?.delivery_prio === true, status: null, proof: null, picked_up_at: null });
    return out;
  }

  function deriveLegacyFromStops(stops) {
    const pickups = stops.filter((s) => s.type === "pickup");
    const deliveries = stops.filter((s) => s.type === "delivery");
    return {
      pickup_address: pickups[0]?.address || "",
      delivery_address: deliveries[deliveries.length - 1]?.address || "",
      pickup_prio: !!pickups[0]?.prio,
      delivery_prio: !!deliveries[deliveries.length - 1]?.prio,
    };
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
    if (stops.some((s) => s.status === "OPGEHAALD")) return "OPGEHAALD";
    return "AANGEMAAKT";
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

  // Status button highlighting
  function statusBtnClass(currentStatus, btnStatus) {
    return currentStatus === btnStatus ? "dvkStatusBtn dvkStatusBtnActive" : "dvkStatusBtn";
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

  // ---------------- Type “overig”
  if (shipmentTypeEl && otherWrap) {
    shipmentTypeEl.addEventListener("change", () => {
      otherWrap.style.display = shipmentTypeEl.value === "overig" ? "block" : "none";
    });
  }

  // ---------------- Google Places attach
  function attachPlacesToInput(inputEl) {
  try {
    if (!inputEl) return;
    if (inputEl.dataset.placesAttached === "1") return;
    if (!window.google || !google.maps || !google.maps.places) return;

    const ac = new google.maps.places.Autocomplete(inputEl, {
      fields: ["formatted_address", "name", "place_id"],
      // GEEN types filter -> dan krijg je adressen + bedrijven
      // types: ["geocode"],
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      // Als het een bedrijf is, gebruik name + formatted_address
      if (place?.name && place?.formatted_address) {
        inputEl.value = `${place.name}, ${place.formatted_address}`;
      } else if (place?.formatted_address) {
        inputEl.value = place.formatted_address;
      } else if (place?.name) {
        inputEl.value = place.name;
      }
    });

    inputEl.dataset.placesAttached = "1";
  } catch (e) {
    console.warn("Places attach failed:", e);
  }
}

  function initAutocomplete() {
    if (stopsWrap) stopsWrap.querySelectorAll("input.stopAddress").forEach(attachPlacesToInput);
    attachPlacesToInput(legacyPickupInput);
    attachPlacesToInput(legacyDeliveryInput);

    if (editStopsWrap) editStopsWrap.querySelectorAll("input.editStopAddress").forEach(attachPlacesToInput);
  }

  // ---------------- Stops UI (Create)
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

    row.querySelector(".stopRemove").addEventListener("click", () => {
      row.remove();
      if (window.__dvkMaybeAutoRecalcRoute) window.__dvkMaybeAutoRecalcRoute();
    });

    return row;
  }

  function ensureDefaultStops() {
    if (!hasStopsUI()) return;
    if (!stopsWrap) return;
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
    if (!hasStopsUI() || !stopsWrap) return null;
    const rows = [...stopsWrap.querySelectorAll(".stopRow")];

    return rows
      .map((r) => {
        const type = r.dataset.type === "delivery" ? "delivery" : "pickup";
        const address = r.querySelector(".stopAddress")?.value?.trim() || "";
        const prio = !!r.querySelector(".stopPrio")?.checked;
        return { type, address, prio, status: null, proof: null, picked_up_at: null };
      })
      .filter((s) => s.address);
  }

  // ---------------- Events — dedupe AANGEMAAKT
  async function addEvent(shipmentId, eventType, note = null, stopIndex = null) {
    const supabaseClient = await ensureClient();

    if (eventType === "AANGEMAAKT") {
      const { data: existing } = await supabaseClient
        .from("shipment_events")
        .select("id")
        .eq("shipment_id", shipmentId)
        .eq("event_type", "AANGEMAAKT")
        .limit(1);
      if (existing && existing.length) return;
    }

    const payload = { shipment_id: shipmentId, event_type: eventType, note };
    if (stopIndex !== null && stopIndex !== undefined) payload.stop_index = stopIndex;

    const { error } = await supabaseClient.from("shipment_events").insert(payload);
    if (error) console.warn("event insert error:", error);
  }

  // ---------------- Update shipment row
  async function updateShipmentRow(shipmentId, patch) {
    const supabaseClient = await ensureClient();
    const { error } = await supabaseClient
      .from("shipments")
      .update(patch)
      .eq("id", shipmentId)
      .eq("driver_id", currentUserId);

    if (error) throw error;
  }

  // ---------------- AUTO ARCHIVE (when all deliveries delivered)
  async function autoArchiveIfCompleted(shipmentId, stops) {
    const deliveries = (stops || []).filter(s => s.type === "delivery");
    const allDelivered = deliveries.length && deliveries.every(s => s.status === "AFGELEVERD");
    if (!allDelivered) return;

    const nowIso = new Date().toISOString();
    await updateShipmentRow(shipmentId, { status: "GEARCHIVEERD", archived_at: nowIso });
    try { await addEvent(shipmentId, "GEARCHIVEERD", "Automatisch gearchiveerd (alles afgeleverd)"); } catch {}
  }

  // ---------------- UI button helper
  function mkBtn(text, onClick, className = "") {
    const b = document.createElement("button");
    b.textContent = text;
    if (className) b.className = className;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------------- Delete shipment
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

    if (error) return alert("Verwijderen mislukt: " + error.message);
    if (!data || data.length === 0) return alert("Niet verwijderd (RLS/driver_id mismatch).");

    await loadShipments(currentUserId);
  }

  // ---------------- Delivered modal (signature + photos) — PER DELIVERY STOP
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

  function openDeliveredModal(shipment, stopIndex) {
    currentDeliveryShipment = shipment;
    currentDeliveryStopIndex = (typeof stopIndex === "number") ? stopIndex : null;

    if (modalError) modalError.textContent = "";
    if (modalReceiver) modalReceiver.value = "";
    if (modalNote) modalNote.value = "";
    if (photo1) photo1.value = "";
    if (photo2) photo2.value = "";

    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    const st = (currentDeliveryStopIndex !== null) ? stops[currentDeliveryStopIndex] : null;

    const firstP = stops.find(x => x.type === "pickup")?.address || shipment.pickup_address || "";
    const lastD = [...stops].reverse().find(x => x.type === "delivery")?.address || shipment.delivery_address || "";

    let headerLine = `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`;
    let stopLine = st ? `<br/><span class="small"><b>Bezorgadres:</b> ${escapeHtml(st.address)}</span>` : "";

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
      if (!currentDeliveryShipment || typeof currentDeliveryStopIndex !== "number") return;

      const receiver = modalReceiver?.value?.trim() || "";
      const note = modalNote?.value?.trim() || null;

      if (!receiver) {
        if (modalError) modalError.textContent = "Naam ontvanger is verplicht.";
        modalReceiver?.focus();
        return;
      }
      if (!hasSignature) {
        if (modalError) modalError.textContent = "Handtekening is verplicht.";
        return;
      }

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

        if (photo1?.files && photo1.files[0]) {
          const f = photo1.files[0];
          p1 = `${base}/photo1-${f.name}`;
          await uploadFile(bucket, p1, f, f.type || "image/jpeg");
        }
        if (photo2?.files && photo2.files[0]) {
          const f = photo2.files[0];
          p2 = `${base}/photo2-${f.name}`;
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

        const shipment = currentDeliveryShipment;
        const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);

        if (!stops[currentDeliveryStopIndex]) throw new Error("Stop bestaat niet (index mismatch).");

        // Only for delivery stops
        if (stops[currentDeliveryStopIndex].type !== "delivery") {
          throw new Error("Aflever-modal mag alleen op bezorgadressen gebruikt worden.");
        }

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

        try {
          const st = stops[currentDeliveryStopIndex];
          await addEvent(
            shipment.id,
            overall,
            `Stop ${currentDeliveryStopIndex + 1} • Bezorgen: ${st.address} • Ontvanger: ${receiver}`,
            currentDeliveryStopIndex
          );
        } catch {}

        // ✅ Auto archive when ALL deliveries delivered
        await autoArchiveIfCompleted(shipment.id, stops);

        closeDeliveredModal();
        await loadShipments(currentUserId);
      } catch (err) {
        console.error(err);
        if (modalError) modalError.textContent = "Fout: " + (err?.message || err);
      } finally {
        modalConfirm.disabled = false;
      }
    });
  }

  // ---------------- Per-stop status update (pickup delivered etc)
  async function updateStopStatus(shipment, stopIndex, newStatus, note = null) {
    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    if (!stops[stopIndex]) return;

    const st0 = stops[stopIndex];

    // Enforce rules:
    // - Pickup: only OPGEHAALD/PROBLEEM
    // - Delivery: only AFGELEVERD/PROBLEEM (AFGELEVERD via modal, so we don't set here)
    if (st0.type === "pickup") {
      if (!["OPGEHAALD", "PROBLEEM"].includes(newStatus)) return;
    } else {
      if (!["PROBLEEM"].includes(newStatus)) return;
    }

    const nowIso = new Date().toISOString();

    stops[stopIndex] = {
      ...st0,
      status: newStatus,
      picked_up_at: (st0.type === "pickup" && newStatus === "OPGEHAALD") ? nowIso : (st0.picked_up_at ?? null),
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
      ...(newStatus === "PROBLEEM" && note ? { problem_note: note } : {}),
    });

    const stopLabel = `${st0.type === "pickup" ? "Ophalen" : "Bezorgen"}: ${st0.address}`;
    try {
      await addEvent(
        shipment.id,
        overall,
        `Stop ${stopIndex + 1} • ${stopLabel}${note ? " • " + note : ""}`,
        stopIndex
      );
    } catch {}

    // If the action caused completion, auto archive
    await autoArchiveIfCompleted(shipment.id, stops);

    await loadShipments(currentUserId);
  }

  // ---------------- Edit modal (stops)
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
    row.querySelector(".stopRemove").addEventListener("click", () => row.remove());
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
        status: null, // merged back
        proof: null,
        picked_up_at: null,
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
    const stops = normalizeStopsFromDb(shipment);
    if (stops.length) {
      stops.forEach((st) => addEditStopRow(st.type, st.address, st.prio));
    } else {
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

    const stops = getStopsFromEditUI();
    const hasPickup = stops.some((s) => s.type === "pickup" && s.address);
    const hasDelivery = stops.some((s) => s.type === "delivery" && s.address);

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
      // Preserve old per-stop status/proof/times by index (best effort)
      const oldStops = normalizeStopsFromDb(currentEditShipment);
      const mergedStops = stops.map((s, i) => ({
        ...s,
        status: oldStops[i]?.status ?? null,
        proof: oldStops[i]?.proof ?? null,
        picked_up_at: oldStops[i]?.picked_up_at ?? null,
      }));

      const legacy = deriveLegacyFromStops(mergedStops);
      const overall = computeOverallStatusFromStops(mergedStops);

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

      // If already complete after edit -> archive
      await autoArchiveIfCompleted(currentEditShipment.id, mergedStops);

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

  // ---------------- Track code
  function generateTrackcode() {
    const year = new Date().getFullYear();
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const n = buf[0] % 1000000;
    const six = String(n).padStart(6, "0");
    return `DVK${year}${six}`;
  }

  // ---------------- Create shipment
  async function createShipment() {
    msg("Bezig...");

    const customer_name = document.getElementById("customer_name")?.value?.trim() || "";
    const shipment_type = document.getElementById("shipment_type")?.value || "doos";
    const shipment_type_other = document.getElementById("shipment_type_other")?.value?.trim() || null;
    const colli_count = parseInt(document.getElementById("colli_count")?.value || "1", 10);

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
        { type: "pickup", address: pickup_address, prio: pickup_prio, status: null, proof: null, picked_up_at: null },
        { type: "delivery", address: delivery_address, prio: delivery_prio, status: null, proof: null, picked_up_at: null },
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
    };

    try {
      const supabaseClient = await ensureClient();

      // Try insert with stops, fallback if no column
      let r = await supabaseClient
        .from("shipments")
        .insert({ ...baseInsert, stops })
        .select("*, stops")
        .single();

      if (r.error && /column/i.test(r.error.message)) {
        r = await supabaseClient
          .from("shipments")
          .insert(baseInsert)
          .select("*, stops")
          .single();
      }
      if (r.error) { msg("Fout: " + r.error.message); return; }

      try { await addEvent(r.data.id, "AANGEMAAKT", null); } catch {}

      msg(`Aangemaakt: ${r.data.track_code}`);

      // reset form
      document.getElementById("customer_name").value = "";
      document.getElementById("colli_count").value = "1";
      document.getElementById("shipment_type").value = "doos";
      const other = document.getElementById("shipment_type_other");
      if (other) other.value = "";
      if (otherWrap) otherWrap.style.display = "none";

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

  // ---------------- PDF helpers (logo + data)
  async function loadImageAsDataUrl(url) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const p = new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = reject;
      });
      img.src = url;
      const loaded = await p;

      const c = document.createElement("canvas");
      c.width = loaded.naturalWidth;
      c.height = loaded.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(loaded, 0, 0);
      return c.toDataURL("image/png");
    } catch {
      return null; // silently ignore
    }
  }

  function fmtDT(iso) {
    try {
      if (!iso) return "";
      return new Date(iso).toLocaleString("nl-NL");
    } catch {
      return "";
    }
  }

  // ---------------- PDF (Afleverbon) — includes logo + pickup/delivery times
  async function downloadAfleverPdf(shipment) {
    if (!window.jspdf?.jsPDF) {
      alert("jsPDF ontbreekt. Controleer script tag in dashboard.html.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    const pickups = stops.filter(s => s.type === "pickup");
    const deliveries = stops.filter(s => s.type === "delivery");

    let y = 42;

    // Logo
    const logoDataUrl = await loadImageAsDataUrl(LOGO_URL);
    if (logoDataUrl) {
      // small logo top-left
      doc.addImage(logoDataUrl, "PNG", 40, 22, 90, 30);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Afleverbon / Bewijs van levering", 40, y); y += 20;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Track & Trace: ${shipment.track_code}`, 40, y); y += 16;

    doc.setFont("helvetica", "normal");
    doc.text(`Klant: ${shipment.customer_name || ""}`, 40, y); y += 14;
    const typeText = shipment.shipment_type === "overig"
      ? (shipment.shipment_type_other || "overig")
      : (shipment.shipment_type || "");
    doc.text(`Type: ${typeText}  •  Colli: ${shipment.colli_count ?? ""}`, 40, y); y += 14;

    doc.text(`Status: ${labelStatus(shipment.status)}`, 40, y); y += 18;

    // Pickups
    doc.setFont("helvetica", "bold");
    doc.text(`Ophaaladres${pickups.length > 1 ? "sen" : ""}:`, 40, y); y += 14;
    doc.setFont("helvetica", "normal");
    if (!pickups.length) {
      doc.text("—", 40, y); y += 14;
    } else {
      pickups.forEach((p, i) => {
        const line = `${pickups.length > 1 ? (i + 1) + ". " : ""}${p.address}${p.prio ? " (PRIO)" : ""}`;
        doc.text(line, 40, y); y += 14;
        const t = p.picked_up_at ? fmtDT(p.picked_up_at) : "";
        doc.text(`   Ophaaltijd: ${t || "—"}`, 40, y); y += 14;
        if (y > 780) { doc.addPage(); y = 42; }
      });
    }

    y += 6;

    // Deliveries
    doc.setFont("helvetica", "bold");
    doc.text(`Bezorgadres${deliveries.length > 1 ? "sen" : ""}:`, 40, y); y += 14;
    doc.setFont("helvetica", "normal");
    if (!deliveries.length) {
      doc.text("—", 40, y); y += 14;
    } else {
      deliveries.forEach((d, i) => {
        const line = `${deliveries.length > 1 ? (i + 1) + ". " : ""}${d.address}${d.prio ? " (PRIO)" : ""}`;
        doc.text(line, 40, y); y += 14;

        const deliveredAt = d.proof?.delivered_at ? fmtDT(d.proof.delivered_at) : "";
        doc.text(`   Bezorgtijd: ${deliveredAt || "—"}`, 40, y); y += 14;

        if (d.proof) {
          doc.text(`   Ontvanger: ${d.proof.receiver_name || "—"}`, 40, y); y += 14;
          if (d.proof.delivered_note) {
            doc.text(`   Opmerking: ${d.proof.delivered_note}`, 40, y); y += 14;
          }
          doc.text(`   Handtekening: ${d.proof.signature_path ? "✅" : "—"}   Foto's: ${(d.proof.photo1_path || d.proof.photo2_path) ? "✅" : "—"}`, 40, y);
          y += 14;
        }

        if (y > 780) { doc.addPage(); y = 42; }
      });
    }

    y += 10;

    // Timeline/events
    doc.setFont("helvetica", "bold");
    doc.text("Tijdpad:", 40, y); y += 14;
    doc.setFont("helvetica", "normal");

    try {
      const supabaseClient = await ensureClient();
      const { data } = await supabaseClient
        .from("shipment_events")
        .select("created_at,event_type,note,stop_index")
        .eq("shipment_id", shipment.id)
        .order("created_at", { ascending: true });

      const events = data || [];
      if (!events.length) {
        doc.text("—", 40, y); y += 14;
      } else {
        events.forEach((ev) => {
          const dt = ev.created_at ? fmtDT(ev.created_at) : "";
          const si = (ev.stop_index === 0 || ev.stop_index) ? ` (stop ${Number(ev.stop_index) + 1})` : "";
          const line = `${dt} — ${labelStatus(ev.event_type)}${si}${ev.note ? " — " + ev.note : ""}`;
          const split = doc.splitTextToSize(line, 520);
          doc.text(split, 40, y);
          y += 14 * split.length;
          if (y > 780) { doc.addPage(); y = 42; }
        });
      }
    } catch {
      doc.text("(Geen events beschikbaar)", 40, y);
    }

    doc.save(`Afleverbon-${shipment.track_code}.pdf`);
  }

  // ---------------- Per-address status UI (ALWAYS)
  function renderStopStatusUI(shipment) {
    const wrap = document.createElement("div");
    wrap.className = "stopStatusWrap";

    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.margin = "8px 0 6px";
    title.textContent = "Adressen:";
    wrap.appendChild(title);

    stops.forEach((st, idx) => {
      const row = document.createElement("div");
      row.className = "stopStatusRow";

      const tag = st.type === "pickup" ? "Ophaaladres" : "Bezorgadres";
      const cur = st.status ? labelStatus(st.status) : "—";
      const prio = st.prio ? ` <span style="color:#0a0;font-weight:800;">PRIO</span>` : "";
      const timeLine =
        st.type === "pickup"
          ? (st.picked_up_at ? `Ophaaltijd: <b>${escapeHtml(fmtDT(st.picked_up_at))}</b>` : `Ophaaltijd: <b>—</b>`)
          : (st.proof?.delivered_at ? `Bezorgtijd: <b>${escapeHtml(fmtDT(st.proof.delivered_at))}</b>` : `Bezorgtijd: <b>—</b>`);

      row.innerHTML = `
        <div class="small" style="flex:1;">
          <b>${idx + 1}. ${escapeHtml(tag)}:</b> ${escapeHtml(st.address)}${prio}<br/>
          <span class="small">Huidig: <b>${escapeHtml(cur)}</b> • ${timeLine}</span>
        </div>
      `;

      const btns = document.createElement("div");
      btns.className = "stopStatusButtons";

      if (st.type === "pickup") {
        // ✅ Pickup: only Opgehaald + Probleem
        btns.appendChild(
          mkBtn(
            "Opgehaald",
            () => updateStopStatus(shipment, idx, "OPGEHAALD"),
            statusBtnClass(st.status, "OPGEHAALD")
          )
        );
        btns.appendChild(
          mkBtn(
            "Probleem",
            async () => {
              const note = prompt("Wat is het probleem?");
              if (!note) return;
              await updateStopStatus(shipment, idx, "PROBLEEM", note);
            },
            statusBtnClass(st.status, "PROBLEEM")
          )
        );
      } else {
        // ✅ Delivery: only Afgeleverd (modal) + Probleem
        btns.appendChild(
          mkBtn(
            "Afgeleverd",
            () => openDeliveredModal(shipment, idx),
            statusBtnClass(st.status, "AFGELEVERD")
          )
        );
        btns.appendChild(
          mkBtn(
            "Probleem",
            async () => {
              const note = prompt("Wat is het probleem?");
              if (!note) return;
              await updateStopStatus(shipment, idx, "PROBLEEM", note);
            },
            statusBtnClass(st.status, "PROBLEEM")
          )
        );
      }

      row.appendChild(btns);
      wrap.appendChild(row);
    });

    return wrap;
  }

  // ---------------- Render shipment card
  function renderShipmentCard(s) {
    const div = document.createElement("div");
    div.className = "shipment";

    const stops = s._stopsNorm || normalizeStopsFromDb(s);
    const firstP = stops.find((x) => x.type === "pickup")?.address || s.pickup_address || "";
    const lastD = [...stops].reverse().find((x) => x.type === "delivery")?.address || s.delivery_address || "";
    const line = stops.length
      ? `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`
      : `${escapeHtml(s.pickup_address)} → ${escapeHtml(s.delivery_address)}`;

    const typeText =
      s.shipment_type === "overig"
        ? (s.shipment_type_other || "overig")
        : (s.shipment_type || "");

    const trackLink = `/DVK/track/?code=${encodeURIComponent(s.track_code)}`;

    div.innerHTML = `
      <div>
        <strong>${escapeHtml(s.track_code)}</strong> — ${escapeHtml(s.customer_name)}<br/>
        <small>${line}</small><br/>
        <small>Type: ${escapeHtml(typeText)} • Colli: ${s.colli_count ?? ""} • Status: <b>${escapeHtml(labelStatus(s.status || ""))}</b></small><br/>
        <small>Track & Trace: <a href="${trackLink}" target="_blank">${trackLink}</a></small>
        <div class="actions"></div>
        <div class="sub"></div>
      </div>
    `;

    const actions = div.querySelector(".actions");
    const sub = div.querySelector(".sub");

    // Always
    actions.appendChild(mkBtn("Aflever-PDF", () => downloadAfleverPdf(s)));
    actions.appendChild(mkBtn("Verwijderen", () => deleteShipment(s)));

    const isArchived = !!s.archived_at || s.status === "GEARCHIVEERD";

    if (!isArchived) {
      actions.appendChild(mkBtn("Wijzigen", () => openEditModal(s)));

      // Per-address buttons block (ALWAYS)
      div.appendChild(renderStopStatusUI(s));
    }

    if (s.problem_note) sub.innerHTML = `<small><b>Probleem:</b> ${escapeHtml(s.problem_note)}</small>`;

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

      // keep legacy fields aligned
      const legacy = deriveLegacyFromStops(s._stopsNorm);
      if (!s.pickup_address && legacy.pickup_address) s.pickup_address = legacy.pickup_address;
      if (!s.delivery_address && legacy.delivery_address) s.delivery_address = legacy.delivery_address;

      return s;
    });

    const archived = all.filter((s) => !!s.archived_at || s.status === "GEARCHIVEERD");
    const active = all.filter((s) => !s.archived_at && s.status !== "GEARCHIVEERD");

    // routeplanner cache: exclude fully delivered shipments (since these auto-archive anyway)
    activeShipmentsCache = active.filter((s) => s.status !== "AFGELEVERD");
    window.activeShipmentsCache = activeShipmentsCache;

    if (listEl) listEl.innerHTML = "";
    if (listArchivedEl) listArchivedEl.innerHTML = "";

    if (active.length === 0) {
      if (listEl) listEl.innerHTML = "<small>Geen actieve zendingen.</small>";
    } else {
      active.forEach((s) => listEl.appendChild(renderShipmentCard(s)));
    }

    if (archived.length === 0) {
      if (listArchivedEl) listArchivedEl.innerHTML = "<small>Geen gearchiveerde zendingen.</small>";
    } else {
      archived.forEach((s) => listArchivedEl.appendChild(renderShipmentCard(s)));
    }

    // auto route
    if (autoRouteEl?.checked && window.__dvkMapsReady) {
      window.__dvkMaybeAutoRecalcRoute?.();
    }
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
    if (!directionsRenderer && map) {
      directionsRenderer = new google.maps.DirectionsRenderer({ map, suppressMarkers: false });
    }
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
      const prio = s.prio ? ' <span style="color:#0a0;font-weight:800;">PRIO</span>' : "";
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
          drivingOptions: {
            departureTime: new Date(),
            trafficModel: google.maps.TrafficModel.BEST_GUESS,
          },
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

  // Greedy: deliveries pas nadat pickups van die shipment geweest zijn
  async function computeOrderedStopsGreedy(stops) {
    if (!stops.length) return [];

    const addrs = [BASE_ADDRESS, ...stops.map((s) => s.address)];
    const matrix = await buildTimeMatrix(addrs);

    const pickupNeed = new Map();
    for (const s of stops) {
      if (s.type === "pickup") pickupNeed.set(s.shipmentId, (pickupNeed.get(s.shipmentId) || 0) + 1);
    }
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

      if (!candidates.length) {
        for (const s of remaining.values()) candidates.push(s);
      }

      let best = null;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const c of candidates) {
        const cIndex = idxOfStop(c);
        let cost = getDurationSeconds(matrix, currentIndex, cIndex);

        // ✅ PRIO gets strong bias
        if (c.prio) cost = cost * 0.35;

        if (cost < bestCost) { bestCost = cost; best = c; }
      }

      ordered.push(best);
      remaining.delete(best.id);

      if (best.type === "pickup") {
        donePickups.set(best.shipmentId, (donePickups.get(best.shipmentId) || 0) + 1);
      }
      currentIndex = idxOfStop(best);
    }

    // laatste stop liefst delivery
    if (ordered.length && ordered[ordered.length - 1].type !== "delivery") {
      const lastDeliveryIdx = [...ordered].map((s, i) => ({ s, i })).reverse().find((x) => x.s.type === "delivery")?.i;
      if (lastDeliveryIdx != null) {
        const d = ordered.splice(lastDeliveryIdx, 1)[0];
        ordered.push(d);
      }
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
      for (const leg of legs) {
        meters += leg?.distance?.value || 0;
        seconds += leg?.duration?.value || 0;
      }
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

  // ✅ EXACT ONE callback for Google Maps
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

  // ---------------- INIT
  ;(async () => {
    try {
      const user = await requireAuth();
      currentUserId = user.id;

      ensureDefaultStops();
      setTab("active");
      await loadShipments(currentUserId);

      // Optional realtime refresh (safe)
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
})();
