// DVK Chauffeur Dashboard — STABLE SINGLE-FILE BUILD (v6)
// Fixes:
// - No driver_id=null queries
// - No double init
// - initMaps always defined
// - loadShipments has lock + renders fully (no placeholders)
// - Route planner code ONLY inside planOptimalRoute (no stray code outside functions)
// - Auto route works again (debounced) and won’t loop
// - Realtime: single channel + debounced reload

(() => {
  "use strict";

  // ✅ voorkomt dubbel draaien (vaak oorzaak van “blijft laden”)
  if (window.__dvkDashboardInit) {
    console.warn("DVK dashboard.js draait al — skip duplicate init");
    return;
  }
  window.__dvkDashboardInit = true;

  // ---------------- CONFIG
  const LOGO_URL = "/DVK/images/DVK%20logo3.jpg"; // (nu niet gebruikt, maar laten staan)
  const BASE_ADDRESS = "Vecht en Gein 28, 1393 PZ Nigtevecht, Nederland";

  // ---------------- DOM
  const listEl = document.getElementById("list");
  const listArchivedEl = document.getElementById("listArchived");
  const tabActive = document.getElementById("tabActive");
  const tabArchived = document.getElementById("tabArchived");

  // Create form
  const createMsg = document.getElementById("createMsg");
  const customerNameEl = document.getElementById("customer_name");

  // ✅ In jouw HTML heet create-type/colli ook "edit_*" (dus we pakken die)
  const shipmentTypeEl = document.getElementById("edit_shipment_type");
  const colliCountEl = document.getElementById("edit_colli_count");
  const otherWrap = document.getElementById("edit_otherWrap");
  const shipmentTypeOtherEl = document.getElementById("edit_shipment_type_other");

  const btnCreate = document.getElementById("btnCreate");

  // Stops UI (create)
  const stopsWrap = document.getElementById("stopsWrap");
  const btnAddPickup = document.getElementById("btnAddPickup");
  const btnAddDelivery = document.getElementById("btnAddDelivery");

  // Edit modal
  const editOverlay = document.getElementById("editOverlay");
  const editShipmentInfo = document.getElementById("editShipmentInfo");
  const editCustomer = document.getElementById("editCustomer");
  const editType = document.getElementById("edit_shipment_type");
  const editColli = document.getElementById("edit_colli_count");
  const editOtherWrapEl = document.getElementById("edit_otherWrap");
  const editTypeOther = document.getElementById("edit_shipment_type_other");
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
  const routeStatusEl = document.getElementById("routeStatus"); // ✅ HTML id
  const routeListEl = document.getElementById("routeList");
  const mapEl = document.getElementById("map");
  const routeSummaryEl = document.getElementById("routeSummary");

  // ---------------- STATE
  let currentTab = "active";
  let currentUserId = null;

  // Realtime channel debounce timer
  let rtTimer = null;

  // load lock (voorkomt “blijft laden” loops)
  let isLoadingShipments = false;

  // route lock (voorkomt parallel route berekeningen)
  let isPlanningRoute = false;

  // Proof modal state
  let currentDeliveryShipment = null;
  let currentDeliveryStopIndex = null;

  // Edit state
  let currentEditShipment = null;

  // Active shipments cache (voor routeplanner)
  let activeShipmentsCache = [];
  window.activeShipmentsCache = activeShipmentsCache;

  // Last planned route order -> voor sorteren “Adressen”
  // key = `${shipmentId}_${stopIndex}` -> rank 1..N
  let lastRouteRank = new Map();

  // ---------------- Helpers
  function msg(t) { if (createMsg) createMsg.textContent = t || ""; }
  function routeMsg(t) { if (routeStatusEl) routeStatusEl.textContent = t || ""; }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function fmtDT(iso) {
    try {
      if (!iso) return "";
      return new Date(iso).toLocaleString("nl-NL", {
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
          picked_up_at: x.picked_up_at ?? null,
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

    const allPickupsDone = pickups.length ? pickups.every((s) => s.status === "OPGEHAALD") : true;
    const allDeliveriesDone = deliveries.length ? deliveries.every((s) => s.status === "AFGELEVERD") : false;

    if (allPickupsDone && allDeliveriesDone) return "AFGELEVERD";
    if (pickups.some((s) => s.status === "OPGEHAALD")) return "OPGEHAALD";
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

  // ---------------- Type “overig” (CREATE+EDIT)
  function toggleOtherWrap(selectEl, wrapEl) {
    if (!selectEl || !wrapEl) return;
    wrapEl.style.display = selectEl.value === "overig" ? "block" : "none";
  }
  if (shipmentTypeEl) shipmentTypeEl.addEventListener("change", () => toggleOtherWrap(shipmentTypeEl, otherWrap));
  if (editType) editType.addEventListener("change", () => toggleOtherWrap(editType, editOtherWrapEl));

  // ---------------- Google Places attach
  function attachPlacesToInput(inputEl) {
    try {
      if (!inputEl) return;
      if (inputEl.dataset.placesAttached === "1") return;
      if (!window.google || !google.maps || !google.maps.places) return;

      const ac = new google.maps.places.Autocomplete(inputEl, {
        fields: ["formatted_address", "name", "place_id"],
      });

      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
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
      window.__dvkMaybeAutoRecalcRoute?.();
    });

    return row;
  }

  function ensureDefaultStops() {
    if (!hasStopsUI() || !stopsWrap) return;
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
    if (!hasStopsUI() || !stopsWrap) return [];
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
    if (!currentUserId) throw new Error("currentUserId ontbreekt");
    const supabaseClient = await ensureClient();
    const { error } = await supabaseClient
      .from("shipments")
      .update(patch)
      .eq("id", shipmentId)
      .eq("driver_id", currentUserId);

    if (error) throw error;
  }

  // ---------------- AUTO ARCHIVE
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

    const headerLine = `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`;
    const stopLine = st ? `<br/><span class="small"><b>Bezorgadres:</b> ${escapeHtml(st.address)}</span>` : "";

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
        if (stops[currentDeliveryStopIndex].type !== "delivery") throw new Error("Aflever-modal alleen voor bezorgadressen.");

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
            "AFGELEVERD",
            `Bezorgd: ${st.address} • Ontvanger: ${receiver}${note ? " • " + note : ""}`,
            currentDeliveryStopIndex
          );
        } catch {}

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

  // ---------------- Per-stop status update
  async function updateStopStatus(shipment, stopIndex, newStatus, note = null) {
    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    if (!stops[stopIndex]) return;

    const st0 = stops[stopIndex];

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

    try {
      const addr = st0.address;
      const label = st0.type === "pickup" ? "Ophalen" : "Bezorgen";
      await addEvent(shipment.id, newStatus, `${label}: ${addr}${note ? " • " + note : ""}`, stopIndex);
    } catch {}

    await autoArchiveIfCompleted(shipment.id, stops);
    await loadShipments(currentUserId);
  }

  // ---------------- Edit modal (stops)
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
        status: null,
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

    toggleOtherWrap(editType, editOtherWrapEl);

    if (editStopsWrap) editStopsWrap.innerHTML = "";
    const stops = normalizeStopsFromDb(shipment);
    stops.forEach((st) => addEditStopRow(st.type, st.address, st.prio));

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

    const customer_name = customerNameEl?.value?.trim() || "";
    const shipment_type = shipmentTypeEl?.value || "doos";
    const shipment_type_other = shipmentTypeOtherEl?.value?.trim() || null;
    const colli_count = parseInt(colliCountEl?.value || "1", 10);

    if (!customer_name) { msg("Vul klantnaam in."); return; }
    if (shipment_type === "overig" && !shipment_type_other) { msg("Vul bij 'overig' een type in."); return; }

    const stops = getStopsFromCreateUI();
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
      const r = await supabaseClient
        .from("shipments")
        .insert(baseInsert)
        .select("*, stops")
        .single();

      if (r.error) { msg("Fout: " + r.error.message); return; }

      try { await addEvent(r.data.id, "AANGEMAAKT", null); } catch {}

      msg(`Aangemaakt: ${r.data.track_code}`);

      if (customerNameEl) customerNameEl.value = "";
      if (colliCountEl) colliCountEl.value = "1";
      if (shipmentTypeEl) shipmentTypeEl.value = "doos";
      if (shipmentTypeOtherEl) shipmentTypeOtherEl.value = "";
      toggleOtherWrap(shipmentTypeEl, otherWrap);

      if (stopsWrap) {
        stopsWrap.innerHTML = "";
        ensureDefaultStops();
      }

      await loadShipments(currentUserId);
    } catch (e) {
      console.error(e);
      msg("Fout: " + (e?.message || e));
    }
  }
  if (btnCreate) btnCreate.addEventListener("click", (e) => { e.preventDefault(); createShipment(); });

  // ---------------- Render + Load shipments
  function getStopsSortedByRoute(shipment) {
    const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
    if (!lastRouteRank || lastRouteRank.size === 0) return stops;

    const withMeta = stops.map((st, idx) => {
      const key = `${shipment.id}_${idx}`;
      const rank = lastRouteRank.get(key);
      return { st, idx, rank };
    });

    const anyRanked = withMeta.some(x => Number.isFinite(x.rank));
    if (!anyRanked) return stops;

    withMeta.sort((a, b) => {
      const ar = Number.isFinite(a.rank) ? a.rank : 999999;
      const br = Number.isFinite(b.rank) ? b.rank : 999999;
      if (ar !== br) return ar - br;
      return a.idx - b.idx;
    });

    return withMeta.map(x => ({ ...x.st, _origIndex: x.idx }));
  }

  function renderStopStatusUI(shipment) {
    const wrap = document.createElement("div");
    wrap.className = "stopStatusWrap";

    const sortedStops = getStopsSortedByRoute(shipment);

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.margin = "8px 0 6px";
    title.textContent = "Adressen:";
    wrap.appendChild(title);

    sortedStops.forEach((st, displayIdx) => {
      const realIdx = (typeof st._origIndex === "number") ? st._origIndex : displayIdx;

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
          <b>${displayIdx + 1}. ${escapeHtml(tag)}:</b> ${escapeHtml(st.address)}${prio}<br/>
          <span class="small">Huidig: <b>${escapeHtml(cur)}</b> • ${timeLine}</span>
        </div>
      `;

      const btns = document.createElement("div");
      btns.className = "stopStatusButtons";

      if (st.type === "pickup") {
        btns.appendChild(mkBtn("Opgehaald", () => updateStopStatus(shipment, realIdx, "OPGEHAALD"), statusBtnClass(st.status, "OPGEHAALD")));
        btns.appendChild(mkBtn("Probleem", async () => {
          const note = prompt("Wat is het probleem?");
          if (!note) return;
          await updateStopStatus(shipment, realIdx, "PROBLEEM", note);
        }, statusBtnClass(st.status, "PROBLEEM")));
      } else {
        btns.appendChild(mkBtn("Afgeleverd", () => openDeliveredModal(shipment, realIdx), statusBtnClass(st.status, "AFGELEVERD")));
        btns.appendChild(mkBtn("Probleem", async () => {
          const note = prompt("Wat is het probleem?");
          if (!note) return;
          await updateStopStatus(shipment, realIdx, "PROBLEEM", note);
        }, statusBtnClass(st.status, "PROBLEEM")));
      }

      row.appendChild(btns);
      wrap.appendChild(row);
    });

    return wrap;
  }

  // ---------------- PDF (Afleverbon / Bewijs van levering)
async function downloadAfleverPdf(shipment) {
  if (!window.jspdf?.jsPDF) {
    alert("jsPDF ontbreekt. Controleer script tag in dashboard.html.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  // --- LOGO bovenaan ---
try {
  const logoDataUrl = await fetchToDataUrl(LOGO_URL); // helper die je al toegevoegd hebt
  if (logoDataUrl) {
    // linksboven logo
    doc.addImage(logoDataUrl, "PNG", 40, 26, 120, 40); 
  }
} catch (e) {
  console.warn("Logo laden mislukt:", e);
}

  const bucket = "dvk-delivery";
  const stops = shipment._stopsNorm || normalizeStopsFromDb(shipment);
  const pickups = stops.filter(s => s.type === "pickup");
  const deliveries = stops.filter(s => s.type === "delivery");

  // --- HEADER + LOGO ---
let logoDataUrl = null;
try {
  logoDataUrl = await fetchToDataUrl(LOGO_URL); // /DVK/assets/logo.png
} catch (e) {
  console.warn("Logo laden mislukt:", e);
}

if (logoDataUrl) {
  // linksboven logo (past netjes in max 140x50)
  try {
    addImageFit(doc, logoDataUrl, 40, 30, 140, 50);
  } catch (e) {
    // fallback als addImageFit ooit faalt
    try { doc.addImage(logoDataUrl, "PNG", 40, 30, 140, 50); } catch {}
  }
}

// titel iets lager (onder logo)
let y = 95;

doc.setFont("helvetica", "bold");
doc.setFontSize(16);
doc.text("De Vechtse Koeriers (DVK)", 40, y);

// lijn onder de titel
y += 12;
doc.setDrawColor(210);
doc.line(40, y, 555, y);
y += 22;

// body tekst start
doc.setFontSize(11);
doc.setFont("helvetica", "normal");

  doc.text(`Trackcode: ${shipment.track_code || ""}`, 40, y); y += 16;
  doc.text(`Klant: ${shipment.customer_name || ""}`, 40, y); y += 16;

  const typeText = shipment.shipment_type === "overig"
    ? (shipment.shipment_type_other || "overig")
    : (shipment.shipment_type || "");

  doc.text(`Type: ${typeText}`, 40, y); y += 16;
  doc.text(`Colli: ${shipment.colli_count ?? ""}`, 40, y); y += 16;
  doc.text(`Status: ${labelStatus(shipment.status)}`, 40, y); y += 22;

  // --- ADDRESSES
  doc.setFont("helvetica", "bold");
  doc.text(`Ophaaladres${pickups.length > 1 ? "sen" : ""}:`, 40, y); y += 16;
  doc.setFont("helvetica", "normal");

  if (!pickups.length) {
    doc.text("—", 40, y); y += 16;
  } else {
    pickups.forEach((p, i) => {
      doc.text(`${pickups.length > 1 ? `${i + 1}. ` : ""}${p.address}${p.prio ? " (PRIO)" : ""}`, 40, y);
      y += 16;
      if (y > 760) { doc.addPage(); y = 60; }
    });
  }

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.text(`Bezorgadres${deliveries.length > 1 ? "sen" : ""}:`, 40, y); y += 16;
  doc.setFont("helvetica", "normal");

  if (!deliveries.length) {
    doc.text("—", 40, y); y += 16;
  } else {
    deliveries.forEach((d, i) => {
      doc.text(`${deliveries.length > 1 ? `${i + 1}. ` : ""}${d.address}${d.prio ? " (PRIO)" : ""}`, 40, y);
      y += 16;
      if (y > 760) { doc.addPage(); y = 60; }
    });
  }

  y += 14;

  // --- PROOF PER DELIVERY (receiver + note + signature + photos)
  // We print for every delivered stop that has proof
  for (let i = 0; i < deliveries.length; i++) {
    const d = deliveries[i];
    if (!d?.proof) continue;

    // Title per proof block
    doc.setFont("helvetica", "bold");
    doc.text(`Ontvangst (${deliveries.length > 1 ? `adres ${i + 1}` : "bewijs"}):`, 40, y); y += 16;
    doc.setFont("helvetica", "normal");

    doc.text(`Ontvanger: ${d.proof.receiver_name || "—"}`, 40, y); y += 16;

    const note = d.proof.delivered_note || "";
    if (note) {
      doc.text(`Notitie: ${note}`, 40, y); y += 16;
    }

    // Signature
    const sigPath = d.proof.signature_path || null;
    const sigDataUrl = await storagePathToDataUrl(bucket, sigPath);

    doc.setFont("helvetica", "bold");
    doc.text("Handtekening:", 40, y); y += 10;
    doc.setFont("helvetica", "normal");

    if (sigDataUrl) {
      // signature box
      doc.setDrawColor(200);
      doc.rect(40, y, 260, 90);
      addImageFit(doc, sigDataUrl, 45, y + 5, 250, 80);
      y += 100;
    } else {
      doc.text("—", 40, y); y += 16;
    }

    // Photos
    const p1 = d.proof.photo1_path || null;
    const p2 = d.proof.photo2_path || null;

    const p1Data = await storagePathToDataUrl(bucket, p1);
    const p2Data = await storagePathToDataUrl(bucket, p2);

    if (p1Data || p2Data) {
      doc.setFont("helvetica", "bold");
      doc.text("Foto’s:", 40, y); y += 10;
      doc.setFont("helvetica", "normal");

      // simple layout: 1 row of max 2 photos
      const w = 240;
      const h = 160;

      if (p1Data) addImageFit(doc, p1Data, 40, y, w, h);
      if (p2Data) addImageFit(doc, p2Data, 315, y, w, h);

      y += (h + 18);
    }

    y += 10;
    if (y > 720) { doc.addPage(); y = 60; }
  }

  // --- PAGE 2: TIJDPAD (events)
  try {
    const supabaseClient = await ensureClient();
    const { data: evts, error } = await supabaseClient
      .from("shipment_events")
      .select("event_type, created_at, note")
      .eq("shipment_id", shipment.id)
      .order("created_at", { ascending: true });

    if (!error && evts && evts.length) {
      doc.addPage();
      let ty = 70;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Tijdpad", 40, ty); ty += 18;

      doc.setDrawColor(210);
      doc.line(40, ty, 555, ty); ty += 22;

      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");

      for (const e of evts) {
        const label = labelStatus(e.event_type) || e.event_type;
        const dt = fmtDT(e.created_at);
        doc.text(`${label}: ${dt}`, 40, ty); ty += 16;

        if (e.note) {
          doc.setFontSize(10);
          doc.text(`  ${String(e.note).slice(0, 120)}`, 40, ty);
          ty += 14;
          doc.setFontSize(11);
        }

        if (ty > 780) { doc.addPage(); ty = 60; }
      }
    }
  } catch (e) {
    console.warn("tijdpad load failed:", e);
  }

  doc.save(`Afleverbon-${shipment.track_code}.pdf`);
}

// ---------------- PDF IMAGE HELPERS (logo + signature + photos)
async function blobToDataURL(blob) {
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

async function fetchToDataUrl(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataURL(blob);
  } catch {
    return null;
  }
}

/**
 * Load image from Supabase Storage path (bucket + path) to DataURL
 * Works even if bucket is private (uses download()).
 */
async function storagePathToDataUrl(bucket, path) {
  try {
    if (!path) return null;
    const supabaseClient = await ensureClient();

    // 1) Try download (works with private buckets if policy allows)
    const { data, error } = await supabaseClient.storage.from(bucket).download(path);
    if (!error && data) return await blobToDataURL(data);

    // 2) Fallback: public URL if bucket is public
    const { data: pub } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    if (pub?.publicUrl) return await fetchToDataUrl(pub.publicUrl);

    return null;
  } catch (e) {
    console.warn("storagePathToDataUrl failed:", e);
    return null;
  }
}

// add image with simple max-width/height fit
function addImageFit(doc, dataUrl, x, y, maxW, maxH) {
  if (!dataUrl) return { w: 0, h: 0 };

  // jsPDF needs type: JPEG/PNG; detect quickly:
  const isPng = typeof dataUrl === "string" && dataUrl.startsWith("data:image/png");
  const type = isPng ? "PNG" : "JPEG";

  // naive fit: assume landscape-ish if unknown; jsPDF can't read dimensions directly without extra work
  // We'll use maxW,maxH as final box, preserving aspect roughly by using maxW and maxH.
  // Good enough for signature/photos.
  doc.addImage(dataUrl, type, x, y, maxW, maxH);
  return { w: maxW, h: maxH };
}
  
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

    actions.appendChild(mkBtn("Aflever-PDF", () => downloadAfleverPdf(s)));
    actions.appendChild(mkBtn("Verwijderen", () => deleteShipment(s)));

    const isArchived = !!s.archived_at || s.status === "GEARCHIVEERD";
    if (!isArchived) {
      actions.appendChild(mkBtn("Wijzigen", () => openEditModal(s)));
      div.appendChild(renderStopStatusUI(s));
    }

    if (s.problem_note) sub.innerHTML = `<small><b>Probleem:</b> ${escapeHtml(s.problem_note)}</small>`;
    return div;
  }

  /**
   * loadShipments(driverId, options?)
   * options.silentRoute = true  -> NIET auto-route triggeren (voorkomt loops)
   */
  async function loadShipments(driverId, options = {}) {
    if (!driverId) return;
    if (isLoadingShipments) return;

    isLoadingShipments = true;
    try {
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

        // legacy velden “invullen” voor weergave
        if (!s.pickup_address && legacy.pickup_address) s.pickup_address = legacy.pickup_address;
        if (!s.delivery_address && legacy.delivery_address) s.delivery_address = legacy.delivery_address;

        return s;
      });

      const archived = all.filter((s) => !!s.archived_at || s.status === "GEARCHIVEERD");
      const active = all.filter((s) => !s.archived_at && s.status !== "GEARCHIVEERD");

      // cache voor routeplanner (alleen niet-gearchiveerd)
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

      // ✅ alleen auto-route triggeren als dat mag
      if (!options.silentRoute && autoRouteEl?.checked && window.__dvkMapsReady) {
        window.__dvkMaybeAutoRecalcRoute?.();
      }
    } finally {
      isLoadingShipments = false;
    }
  }

  // ---------------- ROUTEPLANNER (Maps)
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

  function clearRouteList() {
    if (routeListEl) routeListEl.innerHTML = "";
  }

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

  function setRouteSummaryEmpty() {
    if (routeSummaryEl) routeSummaryEl.innerHTML = `Totale afstand: – &nbsp;&nbsp;&nbsp; Totale reistijd: –`;
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
      setRouteSummaryEmpty();
    }
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
          stopIndex: idx,
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

  async function computeOrderedStopsGreedy(stops) {
    if (!stops.length) return [];

    // index 0 = BASE_ADDRESS, daarna stops 1..n
    const addrs = [BASE_ADDRESS, ...stops.map((s) => s.address)];
    const matrix = await buildTimeMatrix(addrs);

    // pickups moeten eerst af voor dezelfde shipment (basislogica)
    const pickupNeed = new Map();
    for (const s of stops) {
      if (s.type === "pickup") pickupNeed.set(s.shipmentId, (pickupNeed.get(s.shipmentId) || 0) + 1);
    }
    const donePickups = new Map();

    const remaining = new Map();
    stops.forEach((s) => remaining.set(s.id, s));

    let currentIndex = 0; // base
    const ordered = [];

    const idxOfStop = (stop) => 1 + stops.findIndex((x) => x.id === stop.id);

    while (remaining.size > 0) {
      // candidates = pickups altijd, deliveries alleen als pickups gedaan (tenzij geen keuze)
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

        // prio krijgt flinke bonus (lager = beter)
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

  async function planOptimalRoute({ silent = false } = {}) {
    if (isPlanningRoute) return;
    isPlanningRoute = true;

    try {
      routeMsg("Route berekenen...");
      clearRouteList();

      const stops = buildStopsFromActiveShipments();
      if (!stops.length) {
        routeMsg("Geen actieve zendingen voor routeplanning.");
        clearRouteList();
        if (directionsRenderer) directionsRenderer.set("directions", null);
        setRouteSummaryEmpty();
        lastRouteRank = new Map();
        return;
      }

      const ordered = await computeOrderedStopsGreedy(stops);
      renderRouteList(ordered);

      // ✅ Save rank map zodat “Adressen” dezelfde volgorde toont
      const rank = new Map();
      ordered.forEach((s, i) => rank.set(`${s.shipmentId}_${s.stopIndex}`, i + 1));
      lastRouteRank = rank;

      const res = await drawRouteOnMap(ordered);
      setRouteSummaryFromDirections(res);

      // ✅ re-render “Adressen” volgorde maar ZONDER auto-route loop
      if (currentUserId) {
        await loadShipments(currentUserId, { silentRoute: true });
      }

      if (!silent) routeMsg(`Route klaar • ${ordered.length} stops • start/eind: Nigtevecht`);
      else routeMsg(`Route bijgewerkt • ${ordered.length} stops`);
    } catch (e) {
      console.error(e);
      routeMsg("Route fout: " + (e?.message || e));
    } finally {
      isPlanningRoute = false;
    }
  }

  function maybeAutoRecalcRoute() {
    if (!autoRouteEl?.checked) return;
    if (!window.__dvkMapsReady) return;

    clearTimeout(window.__dvkRouteTimer);
    window.__dvkRouteTimer = setTimeout(() => planOptimalRoute({ silent: true }), 600);
  }
  window.__dvkMaybeAutoRecalcRoute = maybeAutoRecalcRoute;

  if (btnPlanRoute) btnPlanRoute.addEventListener("click", () => planOptimalRoute({ silent: false }));

  // ✅ Google Maps callback (MOET GLOBAL bestaan)
  window.initMaps = function () {
    try {
      window.__dvkMapsReady = true;
      ensureMapInit();
      initAutocomplete();
      if (autoRouteEl?.checked) window.__dvkMaybeAutoRecalcRoute?.();
    } catch (e) {
      console.error("initMaps error:", e);
    }
  };

  // ---------------- INIT ----------------
  (async () => {
    try {
      const user = await requireAuth();
      if (!user?.id) return;

      currentUserId = user.id;

      ensureDefaultStops();
      setTab("active");
      toggleOtherWrap(shipmentTypeEl, otherWrap);

      await loadShipments(currentUserId);

      // ---- Realtime: single channel + debounce ----
      try {
        const supabaseClient = await ensureClient();

        if (window.__dvkShipmentsChannel) {
          try { await supabaseClient.removeChannel(window.__dvkShipmentsChannel); } catch {}
          window.__dvkShipmentsChannel = null;
        }

        const scheduleReload = () => {
          clearTimeout(rtTimer);
          rtTimer = setTimeout(() => {
            if (currentUserId) loadShipments(currentUserId);
          }, 700);
        };

        window.__dvkShipmentsChannel = supabaseClient
          .channel("shipments_changes")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "shipments",
              filter: `driver_id=eq.${currentUserId}`,
            },
            scheduleReload
          )
          .subscribe();
      } catch (e) {
        console.warn("Realtime subscribe skipped:", e);
      }

    } catch (e) {
      console.error("INIT error:", e);
    }
  })();

})();
