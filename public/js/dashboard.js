// DVK Dashboard (Driver) - Clean & Working (1 file)
//
// Features:
// - Tabs Active/Archived
// - Create shipment (single OR multi-stop)
// - Status buttons + Delivered modal
// - Timeline via shipment_events
// - PDF afleverbon
// - Google Places Autocomplete (bedrijven + adressen)
// - Routeplanner + kaart (pickups vóór deliveries per zending, eindigt altijd met bezorgen)

(() => {
  // ---------------- DOM
  const listEl = document.getElementById("list");
  const listArchivedEl = document.getElementById("listArchived");
  const tabActive = document.getElementById("tabActive");
  const tabArchived = document.getElementById("tabArchived");

  // Create form
  const createMsg = document.getElementById("createMsg");
  const shipmentTypeEl = document.getElementById("shipment_type");
  const otherWrap = document.getElementById("otherWrap");

  // NEW: Stops UI (option B)
  const stopsWrap = document.getElementById("stopsWrap");           // container for stop rows
  const btnAddPickup = document.getElementById("btnAddPickup");     // add pickup stop
  const btnAddDelivery = document.getElementById("btnAddDelivery"); // add delivery stop

  // Fallback inputs (old single fields)
  const legacyPickupInput = document.getElementById("pickup_address");
  const legacyDeliveryInput = document.getElementById("delivery_address");
  const legacyPickupPrio = document.getElementById("pickup_prio");
  const legacyDeliveryPrio = document.getElementById("delivery_prio");

  // Edit modal
  const editOverlay = document.getElementById("editOverlay");
  const editShipmentInfo = document.getElementById("editShipmentInfo");
  const editCustomer = document.getElementById("editCustomer");
  const editPickup = document.getElementById("editPickup");
  const editDelivery = document.getElementById("editDelivery");
  const editType = document.getElementById("editType");
  const editColli = document.getElementById("editColli");
  const editOtherWrap = document.getElementById("editOtherWrap");
  const editTypeOther = document.getElementById("editTypeOther");
  const editError = document.getElementById("editError");
  const editCancel = document.getElementById("editCancel");
  const editSave = document.getElementById("editSave");

  // Edit modal - stops UI
  const editStopsWrap = document.getElementById("editStopsWrap");
  const btnEditAddPickup = document.getElementById("btnEditAddPickup");
  const btnEditAddDelivery = document.getElementById("btnEditAddDelivery");

  // Delivered modal
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

  // Routeplanner DOM
  const btnPlanRoute = document.getElementById("btnPlanRoute");
  const autoRouteEl = document.getElementById("autoRoute"); // checkbox in Routeplanner
  const routeMsgEl = document.getElementById("routeMsg");
  const routeListEl = document.getElementById("routeList");
  const mapEl = document.getElementById("map");
  const routeSummaryEl = document.getElementById("routeSummary");

  // ---------------- STATE
  let currentTab = "active";
  let currentDeliveryShipment = null;
  let currentUserId = null;
  let currentEditShipment = null;

  // cache voor routeplanner
  let activeShipmentsCache = [];
  window.activeShipmentsCache = activeShipmentsCache;

  // depot / start-eindpunt
  const BASE_ADDRESS = "Vecht en Gein 28, 1393 PZ Nigtevecht, Nederland";

  // ---------------- UI Helpers
  function msg(t) {
    if (createMsg) createMsg.textContent = t || "";
  }
  function routeMsg(t) {
    if (routeMsgEl) routeMsgEl.textContent = t || "";
  }
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // ===== Google Places Autocomplete helper =====
function attachPlacesToInput(inputEl) {
  try {
    if (!inputEl) return;
    if (inputEl.dataset.placesAttached === "1") return; // dubbel voorkomen
    if (!window.google || !google.maps || !google.maps.places) return;

    const ac = new google.maps.places.Autocomplete(inputEl, {
      fields: ["formatted_address", "geometry", "name"],
      types: ["geocode"],
    });

    // optioneel: zet direct formatted address terug in input
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (place && place.formatted_address) {
        inputEl.value = place.formatted_address;
      }
    });

    inputEl.dataset.placesAttached = "1";
  } catch (e) {
    console.warn("Places attach failed:", e);
  }
}

  // ===== Edit stops helper =====
function addEditStopRow(type, address = "", prio = false) {
  if (!editStopsWrap) return;

  const row = document.createElement("div");
  row.className = "stopRow";
  row.setAttribute("data-type", type);

 row.innerHTML = `
  <div class="stopType">${type === "pickup" ? "Ophalen" : "Bezorgen"}</div>

  <input class="editStopAddress" placeholder="Straat, huisnr, plaats" value="${escapeHtml(address)}" />

  <label class="prioLine">
    <input class="editStopPrio" type="checkbox" ${prio ? "checked" : ""} />
    <span>PRIO</span>
  </label>

  <button type="button" class="stopRemove">×</button>
`;

  row.querySelector(".stopRemove").addEventListener("click", () => row.remove());

  const addr = row.querySelector(".editStopAddress");
  attachPlacesToInput(addr);

  editStopsWrap.appendChild(row);
}

  function normalizeStopsFromShipment(shipment) {
  // Nieuwe manier: stops_json (jsonb) in Supabase
  const raw = shipment.stops_json || shipment.stops || shipment.stops_jsonb;

  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((x) => ({
        type: x.type === "delivery" ? "delivery" : "pickup",
        address: String(x.address || x.addr || "").trim(),
        prio: x.prio === true || x.priority === true,
      }))
      .filter((x) => x.address);
  }

  // Fallback: oude velden pickup_address / delivery_address
  const p = String(shipment.pickup_address || "").trim();
  const d = String(shipment.delivery_address || "").trim();

  const out = [];
  if (p) out.push({ type: "pickup", address: p, prio: shipment.pickup_prio === true });
  if (d) out.push({ type: "delivery", address: d, prio: shipment.delivery_prio === true });
  return out;
}

  function makeStopRow({ type = "pickup", address = "", prio = false } = {}) {
  const row = document.createElement("div");
  row.className = "stopRow";
  row.dataset.type = type;

  row.innerHTML = `
    <input class="stopAddress" placeholder="Straat, huisnr, plaats" value="${escapeHtml(address)}" />
    <label class="prioLine">
      <input class="stopPrio" type="checkbox" ${prio ? "checked" : ""} />
      <span>PRIO</span>
    </label>
    <button type="button" class="stopRemove">x</button>
  `;

  row.querySelector(".stopRemove").addEventListener("click", () => row.remove());
  return row;
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

  // ---------------- Type switch
  if (shipmentTypeEl && otherWrap) {
    shipmentTypeEl.addEventListener("change", () => {
      otherWrap.style.display = shipmentTypeEl.value === "overig" ? "block" : "none";
    });
  }

  // ===================== MULTI-STOP UI (Option B) =====================
  function hasStopsUI() {
    return !!(stopsWrap && (btnAddPickup || btnAddDelivery));
  }

  function stopRowTemplate({ type = "pickup", addr = "", priority = false } = {}) {
    // type: pickup|delivery
    const row = document.createElement("div");
    row.className = "stopRow";
    row.dataset.type = type;

    const label = document.createElement("div");
    label.className = "stopLabel";
    label.textContent = type === "pickup" ? "Ophaaladres" : "Bezorgadres";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "stopAddress";
    input.placeholder = "Straat, huisnr, plaats";
    input.value = addr || "";
    input.autocomplete = "off";

    const prio = document.createElement("label");
    prio.className = "stopPrio";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "stopPriority";
    cb.checked = !!priority;

    const sp = document.createElement("span");
    sp.textContent = "PRIO";
    prio.appendChild(cb);
    prio.appendChild(sp);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "stopRemove";
    del.textContent = "×";
    del.title = "Verwijderen";
    del.addEventListener("click", () => {
      row.remove();
      // autocomplete opnieuw niet nodig; route/calc kan wel auto:
      if (window.__dvkMaybeAutoRecalcRoute) window.__dvkMaybeAutoRecalcRoute();
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(prio);
    row.appendChild(del);

    return row;
  }

  function ensureAtLeastDefaultStops() {
    if (!hasStopsUI()) return;

    const existing = stopsWrap.querySelectorAll(".stopRow");
    if (existing.length > 0) return;

    // Start met 1 pickup + 1 delivery
    stopsWrap.appendChild(stopRowTemplate({ type: "pickup" }));
    stopsWrap.appendChild(stopRowTemplate({ type: "delivery" }));

    // Autocomplete koppelen (als maps al klaar is)
    if (window.__dvkMapsReady) initAutocomplete();
  }

  function addStop(type) {
    if (!stopsWrap) return;
    stopsWrap.appendChild(stopRowTemplate({ type }));
    if (window.__dvkMapsReady) initAutocomplete();
  }

  if (btnAddPickup) btnAddPickup.addEventListener("click", () => addStop("pickup"));
  if (btnAddDelivery) btnAddDelivery.addEventListener("click", () => addStop("delivery"));

  function getStopsFromUI() {
    if (!hasStopsUI()) return null;

    const rows = [...stopsWrap.querySelectorAll(".stopRow")];
    const stops = rows
      .map((r) => {
        const type = r.dataset.type === "delivery" ? "delivery" : "pickup";
        const addr = r.querySelector(".stopAddress")?.value?.trim() || "";
        const priority = r.querySelector(".stopPriority")?.checked || false;
        return { type, addr, priority };
      })
      .filter((s) => !!s.addr);

    return stops;
  }

  function normalizeStops(stops) {
    // Zorg dat:
    // - min 2 stops
    // - min 1 pickup en min 1 delivery
    // - pickups vóór deliveries (in opslag)
    const clean = (stops || [])
      .map((s) => ({
        type: s.type === "delivery" ? "delivery" : "pickup",
        addr: (s.addr || "").trim(),
        priority: !!s.priority,
      }))
      .filter((s) => s.addr);

    const pickups = clean.filter((s) => s.type === "pickup");
    const deliveries = clean.filter((s) => s.type === "delivery");

    return [...pickups, ...deliveries];
  }

  function deriveLegacyFromStops(stops) {
    const pickups = stops.filter((s) => s.type === "pickup");
    const deliveries = stops.filter((s) => s.type === "delivery");

    const pickup_address = pickups[0]?.addr || "";
    const delivery_address = deliveries[deliveries.length - 1]?.addr || "";

    const pickup_prio = !!pickups[0]?.priority;
    const delivery_prio = !!deliveries[deliveries.length - 1]?.priority;

    return { pickup_address, delivery_address, pickup_prio, delivery_prio };
  }

  // ---------------- Signature pad (Safari proof)
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

  // ---------------- Modal open/close
  function openDeliveredModal(shipment) {
    currentDeliveryShipment = shipment;

    if (modalError) modalError.textContent = "";
    if (modalReceiver) modalReceiver.value = "";
    if (modalNote) modalNote.value = "";
    if (photo1) photo1.value = "";
    if (photo2) photo2.value = "";

    const typeText =
      shipment.shipment_type === "overig"
        ? (shipment.shipment_type_other || "overig")
        : (shipment.shipment_type || "");

    // Toon netjes eerste->laatste, maar als stops bestaan: toon count
    const stops = Array.isArray(shipment.stops) ? shipment.stops : null;
    const legacyLine = `${escapeHtml(shipment.pickup_address)} → ${escapeHtml(shipment.delivery_address)}`;
    let routeLine = legacyLine;

    if (stops?.length) {
      const firstP = stops.find((x) => x.type === "pickup")?.addr || shipment.pickup_address || "";
      const lastD = [...stops].reverse().find((x) => x.type === "delivery")?.addr || shipment.delivery_address || "";
      routeLine = `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`;
    }

    if (modalShipmentInfo) {
      modalShipmentInfo.innerHTML = `
        <b>${escapeHtml(shipment.track_code)}</b><br/>
        ${routeLine}<br/>
        <span class="small">Type: ${escapeHtml(typeText)} • Colli: ${shipment.colli_count ?? ""}</span>
      `;
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
  }

  if (modalCancel) modalCancel.addEventListener("click", closeDeliveredModal);
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeDeliveredModal();
    });
  }

  // ---------------- Edit Modal open/close
  function toggleEditOther() {
    if (!editType || !editOtherWrap) return;
    editOtherWrap.style.display = (editType.value === "overig") ? "block" : "none";
  }

  function openEditModal(shipment) {
  currentEditShipment = shipment;

  if (editError) editError.textContent = "";

  // Info bovenin
  if (editShipmentInfo) {
    editShipmentInfo.innerHTML = `
      <b>${escapeHtml(shipment.track_code || "")}</b><br/>
      <span class="small">${escapeHtml(shipment.customer_name || "")}</span>
    `;
  }

  // Basisvelden
  if (editCustomer) editCustomer.value = shipment.customer_name || "";
  if (editType) editType.value = shipment.shipment_type || "doos";
  if (editColli) editColli.value = String(shipment.colli_count ?? 1);
  if (editTypeOther) editTypeOther.value = shipment.shipment_type_other || "";

  toggleEditOther();

  // ===== Stops (nieuw) =====
// We vullen hier ALLE stops (pickup + deliveries) in de edit modal
if (editStopsWrap) editStopsWrap.innerHTML = "";

const stops = Array.isArray(shipment.stops) ? shipment.stops : [];

if (stops.length) {
  for (const st of stops) {

    const type =
      (st.type || st.stop_type || st.kind || "delivery");

    const address =
      (st.address || st.stop_address || st.addr || "").trim();

    const prio =
      !!(st.prio ?? st.priority ?? st.is_prio ?? false);

    if (address) addEditStopRow(type, address, prio);
  }
} else {
  const pu = (shipment.pickup_address || "").trim();
  const de = (shipment.delivery_address || "").trim();

  if (pu) addEditStopRow("pickup", pu, false);
  if (de) addEditStopRow("delivery", de, false);
}
    
// Edit modal – add stop buttons
if (btnEditAddPickup) {
  btnEditAddPickup.onclick = () => addEditStopRow("pickup");
}

if (btnEditAddDelivery) {
  btnEditAddDelivery.onclick = () => addEditStopRow("delivery");
}

// Open modal
if (editOverlay) editOverlay.style.display = "flex";

setTimeout(() => {
  editCustomer?.focus();
}, 50);
  }

  function closeEditModal() {
    if (editOverlay) editOverlay.style.display = "none";
    currentEditShipment = null;
  }

  if (editCancel) editCancel.addEventListener("click", closeEditModal);

  if (editOverlay) {
    editOverlay.addEventListener("click", (e) => {
      if (e.target === editOverlay) closeEditModal();
    });
  }

  if (editType) editType.addEventListener("change", toggleEditOther);

  // ---------------- Storage helpers
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

  async function getSignedUrl(bucket, path, expiresInSec = 300) {
    if (!path) return null;
    const supabaseClient = await ensureClient();
    const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(path, expiresInSec);
    if (error) throw error;
    return data.signedUrl;
  }

  async function fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Download mislukt: " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function bytesToDataUrl(bytes, mime = "image/png") {
    const blob = new Blob([bytes], { type: mime });
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function fmt(dt) {
    try {
      const d = new Date(dt);
      return isNaN(d) ? "" : d.toLocaleString("nl-NL");
    } catch {
      return "";
    }
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

  // ---------------- Timeline (shipment_events)
  async function addEvent(shipmentId, eventType, note = null) {
    const supabaseClient = await ensureClient();
    const { error } = await supabaseClient
      .from("shipment_events")
      .insert({ shipment_id: shipmentId, event_type: eventType, note });

    if (error) console.error("event insert error:", error);
  }

  async function fetchEventsForShipment(shipmentId) {
    const supabaseClient = await ensureClient();
    const { data, error } = await supabaseClient
      .from("shipment_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("events fetch error:", error);
      return [];
    }
    return data || [];
  }

  // ---------------- Update Status
  async function updateStatus(shipment, newStatus, extra = {}, eventNote = null) {
    const supabaseClient = await ensureClient();

    let err = null;
    const payload = { status: newStatus, ...extra };

    const r1 = await supabaseClient
      .from("shipments")
      .update(payload)
      .eq("id", shipment.id)
      .eq("driver_id", currentUserId);

    err = r1.error;

    if (err && /column/i.test(err.message)) {
      const r2 = await supabaseClient
        .from("shipments")
        .update({ status: newStatus })
        .eq("id", shipment.id)
        .eq("driver_id", currentUserId);

      err = r2.error;
    }

    if (err) {
      alert("Update fout: " + err.message);
      return;
    }

    try {
      await addEvent(shipment.id, newStatus, eventNote);
    } catch (e) {
      console.error("addEvent failed:", e);
    }

    await loadShipments(currentUserId);
  }

  // ---------------- Delete Shipment
  async function deleteShipment(shipment) {
    const ok = confirm(
      `Weet je zeker dat je zending ${shipment.track_code} wilt verwijderen?\n\nDit kan niet ongedaan gemaakt worden.`
    );
    if (!ok) return false;

    const supabaseClient = await ensureClient();

    const { data, error } = await supabaseClient
      .from("shipments")
      .delete()
      .eq("id", shipment.id)
      .eq("driver_id", currentUserId)
      .select("id");

    if (error) {
      alert("Verwijderen mislukt: " + error.message);
      return false;
    }

    if (!data || data.length === 0) {
      alert("Niet verwijderd (waarschijnlijk RLS/geen rechten of driver_id mismatch).");
      return false;
    }

    await loadShipments(currentUserId);
    return true;
  }

  // ===== Helpers voor stops uit edit modal =====
function getStopsFromEditUI() {
  const rows = Array.from(document.querySelectorAll("#editStopsWrap .stopRow"));
  return rows.map(r => {
    const type = r.getAttribute("data-type") || "delivery";
    const address = (r.querySelector(".editStopAddress")?.value || "").trim();
    const prio = !!r.querySelector(".editStopPrio")?.checked;
    return { type, address, prio };
  }).filter(s => s.address);
}

function syncPrimaryFromStops(stops) {
  const firstPickup = stops.find(s => s.type === "pickup");
  const firstDelivery = stops.find(s => s.type === "delivery");

  if (editPickup) editPickup.value = firstPickup?.address || "";
  if (editDelivery) editDelivery.value = firstDelivery?.address || "";
}

  // ---------------- Save Edit
  async function saveEditShipment() {
    if (!currentEditShipment) return;

    const stops = getStopsFromEditUI();
    syncPrimaryFromStops(stops);

    const customer_name = editCustomer?.value?.trim() || "";
    const pickup_address = editPickup?.value?.trim() || "";
    const delivery_address = editDelivery?.value?.trim() || "";
    const shipment_type = editType?.value || "doos";
    const shipment_type_other = editTypeOther?.value?.trim() || null;
    const colli_count = parseInt(editColli?.value || "1", 10);

    if (!customer_name || !pickup_address || !delivery_address) {
      if (editError) editError.textContent = "Vul klantnaam + ophaaladres + bezorgadres in.";
      return;
    }
    if (shipment_type === "overig" && !shipment_type_other) {
      if (editError) editError.textContent = "Vul bij 'overig' een type in.";
      return;
    }

    if (editSave) editSave.disabled = true;
    if (editError) editError.textContent = "Opslaan...";

    try {
      const supabaseClient = await ensureClient();

      const payload = {
  customer_name,
  pickup_address,
  delivery_address,
  shipment_type,
  shipment_type_other: shipment_type === "overig" ? (shipment_type_other || null) : null,
  colli_count,
  stops, // <-- BELANGRIJK
};

      const { error } = await supabaseClient
        .from("shipments")
        .update(payload)
        .eq("id", currentEditShipment.id)
        .eq("driver_id", currentUserId);

      if (error) throw error;

      if (editError) editError.textContent = "";
      closeEditModal();

      await loadShipments(currentUserId); // refresh lijst + auto route
    } catch (e) {
      console.error(e);
      if (editError) editError.textContent = "Fout: " + (e?.message || e);
    } finally {
      if (editSave) editSave.disabled = false;
    }
  }

  if (editSave) editSave.addEventListener("click", saveEditShipment);

  // ---------------- Buttons helper
  function button(text, onClick) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------------- Load Shipments
  async function loadShipments(driverId) {
    const supabaseClient = await ensureClient();

    if (listEl) listEl.innerHTML = "Laden...";
    if (listArchivedEl) listArchivedEl.innerHTML = "";

    const { data, error } = await supabaseClient
      .from("shipments")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      if (listEl) listEl.innerHTML = "Fout: " + error.message;
      return;
    }

    if (listEl) listEl.innerHTML = "";
    if (listArchivedEl) listArchivedEl.innerHTML = "";

    if (!data || data.length === 0) {
      activeShipmentsCache = [];
      window.activeShipmentsCache = activeShipmentsCache;

      if (listEl) listEl.innerHTML = "<small>Geen zendingen.</small>";

      if (window.__dvkMaybeAutoRecalcRoute) window.__dvkMaybeAutoRecalcRoute();
      return;
    }

    const active = [];
    const archived = [];
    for (const s of data) {
      // maak stops usable als array (soms komt JSON als string terug, afhankelijk van setup)
      if (typeof s.stops === "string") {
        try { s.stops = JSON.parse(s.stops); } catch { /* ignore */ }
      }
      if (s.archived_at) archived.push(s);
      else active.push(s);
    }

    activeShipmentsCache = active;
    window.activeShipmentsCache = active;

    setTimeout(() => {
      if (autoRouteEl?.checked && window.__dvkMapsReady) {
        planOptimalRoute();
      }
    }, 400);

    if (listEl) {
      if (active.length === 0) listEl.innerHTML = "<small>Geen actieve zendingen.</small>";
      else for (const s of active) listEl.appendChild(renderShipmentCard(s));
    }

    if (listArchivedEl) {
      if (archived.length === 0) listArchivedEl.innerHTML = "<small>Geen gearchiveerde zendingen.</small>";
      else for (const s of archived) listArchivedEl.appendChild(renderShipmentCard(s));
    }

    if (window.__dvkMaybeAutoRecalcRoute) window.__dvkMaybeAutoRecalcRoute();
  }

  // ---------------- PDF Afleverbon
  async function generateDeliveryPdf(s) {
    try {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("jsPDF is niet geladen. Controleer de CDN in dashboard.html.");
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });

      const bucket = "dvk-delivery";
      const left = 20;
      const right = 190;

      let y = 14;

      const ensureSpace = (need = 10) => {
        if (y + need > 285) {
          doc.addPage();
          y = 14;
        }
      };

      // LOGO
      try {
        const logoUrl = "/DVK/images/DVK%20logo3.jpg";
        const logoBytes = await fetchBytes(logoUrl);
        const logoDataUrl = await bytesToDataUrl(logoBytes, "image/jpeg");
        doc.addImage(logoDataUrl, "JPEG", left, 10, 45, 18);
      } catch (e) {
        console.log("Logo niet geladen:", e);
      }

      doc.setFontSize(16);
      doc.text("De Vechtse Koeriers (DVK)", left, 36);

      y = 48;
      doc.setDrawColor(0);
      doc.line(left, y, right, y);
      y += 10;

      doc.setFontSize(12);

      const typeText =
        s.shipment_type === "overig"
          ? (s.shipment_type_other || "overig")
          : (s.shipment_type || "-");

      doc.text(`Trackcode: ${s.track_code || "-"}`, left, y); y += 8;
      doc.text(`Klant: ${s.customer_name || "-"}`, left, y); y += 8;
      doc.text(`Type: ${typeText}`, left, y); y += 8;
      doc.text(`Colli: ${s.colli_count ?? "-"}`, left, y); y += 8;
      doc.text(`Status: ${labelStatus(s.status)}`, left, y); y += 10;

      // Stops print (als aanwezig)
      const stops = Array.isArray(s.stops) ? s.stops : null;
      if (stops?.length) {
        ensureSpace(10);
        doc.text(`Stops (${stops.length}):`, left, y); y += 8;
        doc.setFontSize(11);
        for (const st of stops) {
          ensureSpace(7);
          const tag = st.type === "pickup" ? "Ophalen" : "Bezorgen";
          const pr = st.priority ? " [PRIO]" : "";
          const line = `${tag}: ${st.addr}${pr}`;
          const lines = doc.splitTextToSize(line, 170);
          for (const ln of lines) {
            ensureSpace(6);
            doc.text(ln, left + 4, y);
            y += 6;
          }
          y += 1;
        }
        doc.setFontSize(12);
        y += 4;
      } else {
        ensureSpace(20);
        doc.text(`Ophaaladres: ${s.pickup_address || "-"}`, left, y); y += 8;
        doc.text(`Bezorgadres: ${s.delivery_address || "-"}`, left, y); y += 10;
      }

      doc.text(`Notitie: ${s.delivered_note || "-"}`, left, y); y += 12;
      doc.text(`Ontvanger: ${s.receiver_name || "-"}`, left, y); y += 10;

      doc.text("Handtekening:", left, y); y += 4;

      if (s.signature_path) {
        try {
          const sigUrl = await getSignedUrl(bucket, s.signature_path, 300);
          const sigBytes = await fetchBytes(sigUrl);
          const sigDataUrl = await bytesToDataUrl(sigBytes, "image/png");
          ensureSpace(35);
          doc.addImage(sigDataUrl, "PNG", left, y, 70, 25);
          y += 30;
        } catch (e) {
          console.log("Handtekening laden mislukt:", e);
          y += 10;
        }
      } else {
        y += 10;
      }

      const photoPaths = [s.photo1_path, s.photo2_path].filter(Boolean);
      if (photoPaths.length) {
        ensureSpace(10);
        doc.setFontSize(12);
        doc.text("Foto’s:", left, y);
        y += 6;

        const imgW = 80;
        const imgH = 55;
        const gap = 6;

        for (let i = 0; i < photoPaths.length; i++) {
          const p = photoPaths[i];
          try {
            const url = await getSignedUrl(bucket, p, 300);
            const bytes = await fetchBytes(url);

            let dataUrl = null;
            try {
              dataUrl = await bytesToDataUrl(bytes, "image/jpeg");
              ensureSpace(imgH + 10);
              const x = left + (i % 2) * (imgW + gap);
              doc.addImage(dataUrl, "JPEG", x, y, imgW, imgH);
            } catch {
              dataUrl = await bytesToDataUrl(bytes, "image/png");
              ensureSpace(imgH + 10);
              const x = left + (i % 2) * (imgW + gap);
              doc.addImage(dataUrl, "PNG", x, y, imgW, imgH);
            }

            if (i % 2 === 1) y += imgH + 8;
          } catch (e) {
            console.log("Foto laden mislukt:", e);
          }
        }
        if (photoPaths.length % 2 === 1) y += imgH + 8;
      }

      const events = await fetchEventsForShipment(s.id);
      const estimated = 14 + (events.length ? events.length * 7 : 10);
      if (y + estimated > 285) {
        doc.addPage();
        y = 18;
      }

      doc.setFontSize(14);
      doc.text("Tijdpad", left, y);
      y += 10;

      doc.setFontSize(11);

      if (!events || events.length === 0) {
        doc.text("Nog geen updates beschikbaar.", left, y);
        y += 8;
      } else {
        for (const ev of events) {
          const when = fmt(ev.created_at);
          const kind = labelStatus(ev.event_type);

          doc.text(`${kind}: ${when}`, left, y);
          y += 7;

          if (ev.event_type === "PROBLEEM" && ev.note) {
            const lines = doc.splitTextToSize(`Probleem: ${ev.note}`, 170);
            for (const ln of lines) {
              ensureSpace(7);
              doc.text(ln, left + 4, y);
              y += 6;
            }
            y += 2;
          }
          ensureSpace(7);
        }
      }

      const safeCode = (s.track_code || "afleverbon").replace(/[^a-z0-9]/gi, "_");
      doc.save(`Afleverbon-${safeCode}.pdf`);
    } catch (err) {
      console.error(err);
      alert("PDF maken mislukt: " + (err?.message || err));
    }
  }

  // ---------------- Render Card
  function renderShipmentCard(s) {
    const div = document.createElement("div");
    div.className = "shipment";

    const typeText =
      s.shipment_type === "overig"
        ? (s.shipment_type_other || "overig")
        : (s.shipment_type || "");

    const trackLink = `/DVK/track/?code=${encodeURIComponent(s.track_code)}`;

    const stops = Array.isArray(s.stops) ? s.stops : null;
    let line = `${escapeHtml(s.pickup_address)} → ${escapeHtml(s.delivery_address)}`;

    if (stops?.length) {
      const firstP = stops.find((x) => x.type === "pickup")?.addr || s.pickup_address || "";
      const lastD = [...stops].reverse().find((x) => x.type === "delivery")?.addr || s.delivery_address || "";
      line = `${escapeHtml(firstP)} → ${escapeHtml(lastD)} <span class="small">(${stops.length} stops)</span>`;
    }

    div.innerHTML = `
      <div>
        <strong>${escapeHtml(s.track_code)}</strong> — ${escapeHtml(s.customer_name)}<br/>
        <small>${line}</small><br/>
        <small>Type: ${escapeHtml(typeText)} • Colli: ${s.colli_count ?? ""} • Status: <b>${escapeHtml(s.status)}</b></small><br/>
        <small>Track & Trace: <a href="${trackLink}" target="_blank">${trackLink}</a></small>
        <div class="actions"></div>
        <div class="sub"></div>
      </div>
    `;

    const actions = div.querySelector(".actions");
    const sub = div.querySelector(".sub");

    if (s.archived_at) {
      actions.append(
        button("Afleverbon (PDF)", async () => {
          await generateDeliveryPdf(s);
        })
      );
    }

    if (!s.archived_at) {
      actions.append(button("Verwijderen", async () => deleteShipment(s)));
      actions.append(button("Wijzigen", () => openEditModal(s)));

      if (s.status === "AFGELEVERD") {
        actions.append(
          button("Archiveer", async () => {
            await updateStatus(s, "GEARCHIVEERD", { archived_at: new Date().toISOString() });
            setTab("archived");
          })
        );
      }

      actions.append(
        button("Opgehaald", () => updateStatus(s, "OPGEHAALD")),
        button("Onderweg", () => updateStatus(s, "ONDERWEG")),
        button("Probleem", async () => {
          const note = prompt("Wat is het probleem?");
          if (!note) return;
          await updateStatus(s, "PROBLEEM", { problem_note: note }, note);
        }),
        button("Afgeleverd", () => openDeliveredModal(s))
      );
    } else {
      actions.append(button("Verwijderen", async () => deleteShipment(s)));
    }

    if (s.problem_note) sub.innerHTML = `<small><b>Probleem:</b> ${escapeHtml(s.problem_note)}</small>`;
    if (s.receiver_name) sub.innerHTML += `${sub.innerHTML ? "<br/>" : ""}<small><b>Ontvanger:</b> ${escapeHtml(s.receiver_name)}</small>`;
    if (s.signature_path) sub.innerHTML += `${sub.innerHTML ? "<br/>" : ""}<small><b>Handtekening:</b> opgeslagen ✅</small>`;
    if (s.photo1_path || s.photo2_path) sub.innerHTML += `${sub.innerHTML ? "<br/>" : ""}<small><b>Foto’s:</b> opgeslagen ✅</small>`;

    return div;
  }

  // ---------------- Create Shipment
  async function createShipment() {
    const supabaseClient = await ensureClient();
    msg("Bezig...");

    const customer_name = document.getElementById("customer_name")?.value?.trim() || "";
    const shipment_type = document.getElementById("shipment_type")?.value || "doos";
    const shipment_type_other = document.getElementById("shipment_type_other")?.value?.trim() || null;
    const colli_count = parseInt(document.getElementById("colli_count")?.value || "1", 10);

    // 1) Verzamel stops (nieuw of legacy)
    let stops = null;

    if (hasStopsUI()) {
      stops = normalizeStops(getStopsFromUI() || []);
    } else {
      // legacy
      const pickup_address = legacyPickupInput?.value?.trim() || "";
      const delivery_address = legacyDeliveryInput?.value?.trim() || "";
      const pickup_prio = legacyPickupPrio?.checked || false;
      const delivery_prio = legacyDeliveryPrio?.checked || false;

      stops = normalizeStops([
        { type: "pickup", addr: pickup_address, priority: pickup_prio },
        { type: "delivery", addr: delivery_address, priority: delivery_prio },
      ]);
    }

    // Validaties
    if (!customer_name) {
      msg("Vul klantnaam in.");
      return;
    }
    if (shipment_type === "overig" && !shipment_type_other) {
      msg("Vul 'overig' type in.");
      return;
    }

    const hasPickup = stops.some((s) => s.type === "pickup");
    const hasDelivery = stops.some((s) => s.type === "delivery");
    if (!stops.length || !hasPickup || !hasDelivery) {
      msg("Voeg minimaal 1 ophaaladres én 1 bezorgadres toe.");
      return;
    }

    // Legacy velden blijven gevuld (voor overzicht/track/pdf/compat)
    const legacy = deriveLegacyFromStops(stops);

    // 2) Insert (probeer met stops kolom; als die niet bestaat -> fallback zonder stops)
    const baseInsert = {
      driver_id: currentUserId,
      customer_name,
      shipment_type,
      shipment_type_other: shipment_type === "overig" ? shipment_type_other : null,
      colli_count,
      pickup_address: legacy.pickup_address,
      delivery_address: legacy.delivery_address,
      pickup_prio: legacy.pickup_prio,
      delivery_prio: legacy.delivery_prio,
      status: "AANGEMAAKT",
    };

    let data = null;

    // eerst proberen met stops
    let r = await supabaseClient
      .from("shipments")
      .insert({ ...baseInsert, stops })
      .select("*")
      .single();

    if (r.error && /column/i.test(r.error.message)) {
      // stops kolom bestaat niet -> fallback
      r = await supabaseClient
        .from("shipments")
        .insert(baseInsert)
        .select("*")
        .single();
    }

    if (r.error) {
      msg("Fout: " + r.error.message);
      return;
    }
    data = r.data;

    // Event: AANGEMAAKT (niet dubbel)
    try {
      const { data: existing, error: e1 } = await supabaseClient
        .from("shipment_events")
        .select("id")
        .eq("shipment_id", data.id)
        .eq("event_type", "AANGEMAAKT")
        .limit(1);

      if (!e1 && (!existing || existing.length === 0)) {
        await addEvent(data.id, "AANGEMAAKT", null);
      }
    } catch (e) {
      console.warn("AANGEMAAKT event check/add failed:", e);
    }

    msg(`Aangemaakt: ${data.track_code}`);

    // 3) Form reset
    document.getElementById("customer_name").value = "";
    document.getElementById("colli_count").value = "1";
    document.getElementById("shipment_type").value = "doos";

    const other = document.getElementById("shipment_type_other");
    if (other) other.value = "";
    if (otherWrap) otherWrap.style.display = "none";

    if (hasStopsUI()) {
      // clear all stop rows and set default 1+1 again
      stopsWrap.innerHTML = "";
      ensureAtLeastDefaultStops();
    } else {
      // legacy clear
      if (legacyPickupInput) legacyPickupInput.value = "";
      if (legacyDeliveryInput) legacyDeliveryInput.value = "";
      if (legacyPickupPrio) legacyPickupPrio.checked = false;
      if (legacyDeliveryPrio) legacyDeliveryPrio.checked = false;
    }

    await loadShipments(currentUserId);
  }

  // ---------------- Delivered Modal Confirm
  if (modalConfirm) {
    modalConfirm.addEventListener("click", async () => {
      if (!currentDeliveryShipment) return;

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
        const base = `${currentUserId}/${track}`;

        const sigBlob = await canvasToBlob(sigCanvas);
        const sigPath = `${base}/signature.png`;
        await uploadFile(bucket, sigPath, sigBlob, "image/png");

        let p1 = null, p2 = null;

        if (photo1?.files && photo1.files[0]) {
          const f = photo1.files[0];
          p1 = `${base}/photo1-${Date.now()}`;
          await uploadFile(bucket, p1, f, f.type || "image/jpeg");
        }
        if (photo2?.files && photo2.files[0]) {
          const f = photo2.files[0];
          p2 = `${base}/photo2-${Date.now()}`;
          await uploadFile(bucket, p2, f, f.type || "image/jpeg");
        }

        if (modalError) modalError.textContent = "Opslaan...";

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

  // ================= AUTOCOMPLETE (start pas NA maps loaded) =================
  function initAutocomplete() {
    if (!window.google?.maps?.places?.Autocomplete) {
      console.warn("Google Places Autocomplete niet beschikbaar (check libraries=places).");
      return;
    }

    const options = { componentRestrictions: { country: "nl" } };

    function buildAddressFromComponents(components) {
      if (!components?.length) return "";
      const get = (type) => components.find((c) => c.types.includes(type))?.long_name || "";

      const route = get("route");
      const streetNumber = get("street_number");
      const postalCode = get("postal_code");
      const locality = get("locality") || get("postal_town");

      const line1 = [route, streetNumber].filter(Boolean).join(" ");
      const line2 = [postalCode, locality].filter(Boolean).join(" ");
      return [line1, line2].filter(Boolean).join(", ");
    }

    function attach(input) {
      if (!input) return;
      if (input.dataset.__dvkAcAttached === "1") return;

      input.setAttribute("autocomplete", "off");

      const ac = new google.maps.places.Autocomplete(input, options);
      if (ac.setFields) ac.setFields(["formatted_address", "address_components", "name", "place_id"]);

      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        let full = place?.formatted_address || buildAddressFromComponents(place?.address_components);
        const name = (place?.name || "").trim();

        if (name) {
          const lowerFull = (full || "").toLowerCase();
          const lowerName = name.toLowerCase();
          if (full && !lowerFull.includes(lowerName)) input.value = `${name}, ${full}`;
          else if (full) input.value = full;
          else input.value = name;
        } else {
          if (full) input.value = full;
        }
      });

      input.dataset.__dvkAcAttached = "1";
    }

    // NEW: stop inputs
    if (hasStopsUI()) {
      const inputs = stopsWrap.querySelectorAll(".stopAddress");
      inputs.forEach((i) => attach(i));
    } else {
      // legacy inputs
      attach(legacyPickupInput);
      attach(legacyDeliveryInput);
    }
  }

  // ================= ROUTEPLANNER + MAP =================
  let map = null;
  let directionsService = null;
  let directionsRenderer = null;

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
      const prio = s.priority ? ' <span style="color:#c00;font-weight:800;">P</span>' : "";
      row.innerHTML = `${i + 1}. ${escapeHtml(s.label)}${prio}`;
      routeListEl.appendChild(row);
    });
  }

  function ensureMapsReady() {
    if (!window.google?.maps) throw new Error("Google Maps API niet geladen.");
  }

  function ensureMapInit() {
    ensureMapsReady();

    if (!map && mapEl) {
      map = new google.maps.Map(mapEl, {
        zoom: 9,
        center: { lat: 52.27, lng: 5.07 }, // Nigtevecht
        mapTypeControl: true,
      });
    }

    if (!directionsService) directionsService = new google.maps.DirectionsService();
    if (!directionsRenderer && map) {
      directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: false,
      });
    }
  }

  function buildStopsFromActiveShipments() {
    const stops = [];

    for (const s of (window.activeShipmentsCache || [])) {
      if (s.archived_at) continue;

      // prefer stops[] als aanwezig
      let shipStops = null;
      if (typeof s.stops === "string") {
        try { shipStops = JSON.parse(s.stops); } catch { shipStops = null; }
      } else if (Array.isArray(s.stops)) {
        shipStops = s.stops;
      }

      if (Array.isArray(shipStops) && shipStops.length) {
        const normalized = normalizeStops(shipStops);

        // maak stop-id’s stabiel per shipment + index
        normalized.forEach((st, idx) => {
          const id = `${st.type}_${s.id}_${idx}`;
          const tag = st.type === "pickup" ? "Ophalen" : "Bezorgen";
          stops.push({
            id,
            shipmentId: s.id,
            type: st.type,
            addr: (st.addr || "").trim(),
            priority: st.priority === true,
            label: `${tag}: ${st.addr} (${s.track_code || ""})`,
          });
        });

        continue;
      }

      // fallback legacy
      const p = (s.pickup_address || "").trim();
      const d = (s.delivery_address || "").trim();
      if (!p || !d) continue;

      stops.push({
        id: `pick_${s.id}`,
        shipmentId: s.id,
        type: "pickup",
        addr: p,
        priority: s.pickup_prio === true,
        label: `Ophalen: ${p} (${s.track_code || ""})`,
      });

      stops.push({
        id: `del_${s.id}`,
        shipmentId: s.id,
        type: "delivery",
        addr: d,
        priority: s.delivery_prio === true,
        label: `Bezorgen: ${d} (${s.track_code || ""})`,
      });
    }

    return stops;
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

  // Greedy met constraint:
  // - deliveries pas nadat ALLE pickups van die shipment zijn geweest
  // - eindigt altijd met delivery (als er deliveries bestaan)
  async function computeOrderedStopsGreedy(stops) {
    if (!stops.length) return [];

    const addrs = [BASE_ADDRESS, ...stops.map((s) => s.addr)];
    const matrix = await buildTimeMatrix(addrs);

    const pickupNeed = new Map(); // shipmentId -> pickup count
    for (const s of stops) {
      if (s.type !== "pickup") continue;
      pickupNeed.set(s.shipmentId, (pickupNeed.get(s.shipmentId) || 0) + 1);
    }

    const donePickupsCount = new Map(); // shipmentId -> how many pickups done

    const remaining = new Map(); // id->stop
    stops.forEach((s) => remaining.set(s.id, s));

    let currentIndex = 0; // BASE
    const ordered = [];

    const idxOfStop = (stop) => 1 + stops.findIndex((x) => x.id === stop.id);

    while (remaining.size > 0) {
      const candidates = [];

      for (const s of remaining.values()) {
        if (s.type === "pickup") {
          candidates.push(s);
          continue;
        }

        // delivery: pas als alle pickups gedaan zijn
        const need = pickupNeed.get(s.shipmentId) || 0;
        const done = donePickupsCount.get(s.shipmentId) || 0;
        if (need === 0 || done >= need) candidates.push(s);
      }

      if (!candidates.length) {
        // safety fallback: neem alles
        for (const s of remaining.values()) candidates.push(s);
      }

      let best = null;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const c of candidates) {
        const cIndex = idxOfStop(c);
        let cost = getDurationSeconds(matrix, currentIndex, cIndex);

        // PRIORITEIT BOOST
        if (c.priority) cost = cost * 0.3;

        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }

      ordered.push(best);
      remaining.delete(best.id);

      if (best.type === "pickup") {
        donePickupsCount.set(best.shipmentId, (donePickupsCount.get(best.shipmentId) || 0) + 1);
      }

      currentIndex = idxOfStop(best);
    }

    // Hard fix: laatste stop moet delivery zijn (als er deliveries bestaan)
    if (ordered.length && ordered[ordered.length - 1].type !== "delivery") {
      const lastDeliveryIdx = [...ordered]
        .map((s, i) => ({ s, i }))
        .reverse()
        .find((x) => x.s.type === "delivery")?.i;

      if (lastDeliveryIdx != null) {
        const del = ordered.splice(lastDeliveryIdx, 1)[0];
        ordered.push(del);
      }
    }

    return ordered;
  }

  async function drawRouteOnMap(orderedStops) {
    ensureMapInit();

    const waypoints = orderedStops.map((s) => ({
      location: s.addr,
      stopover: true,
    }));

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
    } catch (e) {
      console.warn("route summary calc failed:", e);
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

  // debounce auto reroute
  function maybeAutoRecalcRoute() {
    if (!autoRouteEl?.checked) return;
    if (!window.__dvkMapsReady) return;

    clearTimeout(window.__dvkRouteTimer);
    window.__dvkRouteTimer = setTimeout(() => planOptimalRoute(), 400);
  }
  window.__dvkMaybeAutoRecalcRoute = maybeAutoRecalcRoute;

  if (btnPlanRoute) btnPlanRoute.addEventListener("click", () => planOptimalRoute());

  // Google Maps callback (callback=initMaps in HTML)
  window.initMaps = function () {
    try {
      console.log("Google Maps geladen");
      window.__dvkMapsReady = true;

      ensureMapInit();
      initAutocomplete();

      if (autoRouteEl?.checked) {
        planOptimalRoute();
      }
    } catch (e) {
      console.error("initMaps error:", e);
    }
  };

  // ---------------- INIT
  (async () => {
    const user = await requireAuth();
    currentUserId = user.id;

    // Maak default stops (als UI bestaat)
    ensureAtLeastDefaultStops();

    const btn = document.getElementById("btnCreate");
    if (btn) {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        await createShipment();
      });
    }

    setTab("active");
    await loadShipments(currentUserId);

    // Realtime refresh
    const supabaseClient = await ensureClient();
    supabaseClient
      .channel("shipments_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, () => loadShipments(currentUserId))
      .subscribe();
  })();
})();
