// DVK Dashboard - delivered modal + signature + photo upload

const listEl = document.getElementById("list");
const createMsg = document.getElementById("createMsg");
const typeEl = document.getElementById("shipment_type");
const otherWrap = document.getElementById("otherWrap");

// modal elements
const overlay = document.getElementById("modalOverlay");
const modalShipmentInfo = document.getElementById("modalShipmentInfo");
const modalReceiver = document.getElementById("modalReceiver");
const modalNote = document.getElementById("modalNote");
const modalError = document.getElementById("modalError");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");

// signature
const sigCanvas = document.getElementById("sigCanvas");
const sigClear = document.getElementById("sigClear");

// photos
const photo1 = document.getElementById("photo1");
const photo2 = document.getElementById("photo2");

let currentDeliveryShipment = null;
let currentUserId = null;

// ---------------- helpers
function msg(t) { if (createMsg) createMsg.textContent = t || ""; }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function ensureClient() {
  if (!window.supabaseClient) throw new Error("supabaseClient missing");
  return window.supabaseClient;
}

async function requireAuth() {
  const supabaseClient = await ensureClient();
  const { data } = await supabaseClient.auth.getSession();
  if (!data?.session) {
    window.location.href = "/DVK/driver/login.html";
    throw new Error("Not logged in");
  }
  return data.session.user;
}

// ---------------- logout
const logoutBtn = document.getElementById("btnLogout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    const supabaseClient = await ensureClient();
    await supabaseClient.auth.signOut();
    window.location.href = "/DVK/driver/login.html";
  });
}

// ---------------- type switch
if (typeEl && otherWrap) {
  typeEl.addEventListener("change", () => {
    otherWrap.style.display = (typeEl.value === "overig") ? "block" : "none";
  });
}

// ---------------- signature pad (Pointer Events, Safari proof)
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

// ---------------- events timeline
async function addEvent(shipmentId, eventType, note = null) {
  const supabaseClient = await ensureClient();
  const { error } = await supabaseClient
    .from("shipment_events")
    .insert({ shipment_id: shipmentId, event_type: eventType, note });
  if (error) console.error("event insert error:", error);
}

// ---------------- list + update
async function loadShipments(driverId) {
  const supabaseClient = await ensureClient();
  listEl.innerHTML = "Laden...";

  const { data, error } = await supabaseClient
    .from("shipments")
    .select("*")
    .eq("driver_id", driverId)
    .neq("status", "GEARCHIVEERD")
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = "Fout: " + error.message;
    return;
  }

  listEl.innerHTML = "";
  if (!data || data.length === 0) {
    listEl.innerHTML = "<small>Geen actieve zendingen.</small>";
    return;
  }

  for (const s of data) listEl.appendChild(renderShipmentCard(s));
}

async function updateStatus(shipment, newStatus, extra = {}) {
  const supabaseClient = await ensureClient();

  const { error } = await supabaseClient
    .from("shipments")
    .update({ status: newStatus, ...extra })
    .eq("id", shipment.id);

  if (error) {
    alert("Update fout: " + error.message);
    return;
  }

  const eventNote = extra.problem_note || extra.delivered_note || extra.archive_note || null;
  await addEvent(shipment.id, newStatus, eventNote);
  await loadShipments(shipment.driver_id);
}

function button(text, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

// ---------------- modal open/close
function openDeliveredModal(shipment) {
  currentDeliveryShipment = shipment;

  modalError.textContent = "";
  modalReceiver.value = "";
  modalNote.value = "";
  photo1.value = "";
  photo2.value = "";

  const typeText = shipment.shipment_type === "overig"
    ? (shipment.shipment_type_other || "overig")
    : shipment.shipment_type;

  modalShipmentInfo.innerHTML = `
    <b>${escapeHtml(shipment.track_code)}</b><br/>
    ${escapeHtml(shipment.pickup_address)} → ${escapeHtml(shipment.delivery_address)}<br/>
    <span class="small">Type: ${escapeHtml(typeText)} • Colli: ${shipment.colli_count}</span>
  `;

  overlay.style.display = "flex";

  // canvas pas correct schalen als modal zichtbaar is
  setTimeout(() => {
    setupCanvasForDPR();
    sigReset();
    modalReceiver.focus();
  }, 60);
}

function closeDeliveredModal() {
  overlay.style.display = "none";
  currentDeliveryShipment = null;
}

modalCancel.addEventListener("click", closeDeliveredModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeDeliveredModal();
});

// ---------------- upload helpers
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

modalConfirm.addEventListener("click", async () => {
  if (!currentDeliveryShipment) return;

  const receiver = modalReceiver.value.trim();
  const note = modalNote.value.trim() || null;

  if (!receiver) {
    modalError.textContent = "Naam ontvanger is verplicht.";
    modalReceiver.focus();
    return;
  }
  if (!hasSignature) {
    modalError.textContent = "Handtekening is verplicht.";
    return;
  }

  modalConfirm.disabled = true;
  modalError.textContent = "Uploaden...";

  try {
    const bucket = "dvk-delivery";
    const track = currentDeliveryShipment.track_code;
    const base = `${currentUserId}/${track}`;

    // signature
    const sigBlob = await canvasToBlob(sigCanvas);
    const sigPath = `${base}/signature.png`;
    await uploadFile(bucket, sigPath, sigBlob, "image/png");

    // photos optional
    let p1 = null, p2 = null;

    if (photo1.files && photo1.files[0]) {
      const f = photo1.files[0];
      p1 = `${base}/photo1-${Date.now()}`;
      await uploadFile(bucket, p1, f, f.type || "image/jpeg");
    }
    if (photo2.files && photo2.files[0]) {
      const f = photo2.files[0];
      p2 = `${base}/photo2-${Date.now()}`;
      await uploadFile(bucket, p2, f, f.type || "image/jpeg");
    }

    modalError.textContent = "Opslaan...";

    await updateStatus(currentDeliveryShipment, "AFGELEVERD", {
      receiver_name: receiver,
      delivered_note: note,
      signature_path: sigPath,
      photo1_path: p1,
      photo2_path: p2
    });

    closeDeliveredModal();
  } catch (err) {
    console.error(err);
    modalError.textContent = "Fout: " + (err?.message || err);
  } finally {
    modalConfirm.disabled = false;
  }
});

// ---------------- card render
function renderShipmentCard(s) {
  const div = document.createElement("div");
  div.className = "shipment";

  const typeText =
    (s.shipment_type === "overig")
      ? (s.shipment_type_other || "overig")
      : s.shipment_type;

  const trackLink = `/DVK/track/?code=${encodeURIComponent(s.track_code)}`;

  div.innerHTML = `
    <div>
      <strong>${escapeHtml(s.track_code)}</strong> — ${escapeHtml(s.customer_name)}<br/>
      <small>${escapeHtml(s.pickup_address)} → ${escapeHtml(s.delivery_address)}</small><br/>
      <small>Type: ${escapeHtml(typeText)} • Colli: ${s.colli_count} • Status: <b>${escapeHtml(s.status)}</b></small><br/>
      <small>Track & Trace: <a href="${trackLink}" target="_blank">${trackLink}</a></small>
      <div class="actions"></div>
      <div class="sub"></div>
    </div>
  `;

  const actions = div.querySelector(".actions");
  const sub = div.querySelector(".sub");

  // Alleen wijzigen als NIET gearchiveerd (beste check: archived_at is leeg)
if (!s.archived_at) {
  actions.append(button("Wijzigen", () => openEditMode(div, s)));
}

actions.append(
  button("Opgehaald", () => updateStatus(s, "OPGEHAALD")),
  button("Onderweg", () => updateStatus(s, "ONDERWEG")),
  button("Probleem", async () => {
    const note = prompt("Wat is het probleem?");
    if (!note) return;
    await updateStatus(s, "PROBLEEM", { problem_note: note });
  }),
  button("Afgeleverd", () => openDeliveredModal(s))
);

  if (s.problem_note) sub.innerHTML = `<small><b>Probleem:</b> ${escapeHtml(s.problem_note)}</small>`;
  if (s.receiver_name) sub.innerHTML += `<br/><small><b>Ontvanger:</b> ${escapeHtml(s.receiver_name)}</small>`;
  if (s.signature_path) sub.innerHTML += `<br/><small><b>Handtekening:</b> opgeslagen ✅</small>`;
  if (s.photo1_path || s.photo2_path) sub.innerHTML += `<br/><small><b>Foto’s:</b> opgeslagen ✅</small>`;

  return div;
}

// ===============================
// EDIT MODE
// ===============================

function openEditMode(cardDiv, shipment) {
  const form = document.createElement("div");
  form.innerHTML = `
  <hr/>
  <b>Zending wijzigen</b><br/><br/>

  <label>Klantnaam</label>
  <input id="editCustomer" value="${escapeHtml(shipment.customer_name)}" />

  <label>Ophaaladres</label>
  <input id="editPickup" value="${escapeHtml(shipment.pickup_address)}" />

  <label>Bezorgadres</label>
  <input id="editDelivery" value="${escapeHtml(shipment.delivery_address)}" />

  <label>Type zending</label>
  <select id="editType">
    <option value="doos">Doos</option>
    <option value="enveloppe">Enveloppe</option>
    <option value="pallet">Pallet</option>
    <option value="overig">Overig</option>
  </select>

  <div id="editOtherWrap" style="display:none;">
    <label>Overig (invullen)</label>
    <input id="editOther" placeholder="Bijv. koelbox / tas" value="${escapeHtml(shipment.shipment_type_other || "")}" />
  </div>

  <label>Aantal colli</label>
  <input id="editColli" type="number" min="1" value="${shipment.colli_count}" />

  <br/><br/>
  <button id="saveEdit">Opslaan</button>
  <button id="cancelEdit" type="button">Annuleren</button>
`;
  // ✅ Stap 2: default waarde + overig tonen/verbergen
const editType = form.querySelector("#editType");
const editOtherWrap = form.querySelector("#editOtherWrap");
const editOther = form.querySelector("#editOther");

if (editType) {
  editType.value = shipment.shipment_type || "doos";
}

function toggleOther() {
  const isOther = editType && editType.value === "overig";
  if (editOtherWrap) editOtherWrap.style.display = isOther ? "block" : "none";
}

toggleOther();
if (editType) editType.addEventListener("change", toggleOther);

// Zet bestaande overig waarde alvast goed
if (editOther && shipment.shipment_type_other) {
  editOther.value = shipment.shipment_type_other;
}
  cardDiv.appendChild(form);

  document.getElementById("cancelEdit").onclick = () => {
    loadShipments(currentUserId);
  };

  document.getElementById("saveEdit").onclick = async () => {
    const supabaseClient = await ensureClient();

    const selectedType = form.querySelector("#editType")?.value || "doos";
const otherValue = form.querySelector("#editOther")?.value || "").trim() || null;

const updatePayload = {
  customer_name: form.querySelector("#editCustomer")?.value || "",
  pickup_address: form.querySelector("#editPickup")?.value || "",
  delivery_address: form.querySelector("#editDelivery")?.value || "",
  shipment_type: selectedType,
  shipment_type_other: selectedType === "overig" ? otherValue : null,
  colli_count: parseInt(form.querySelector("#editColli")?.value || "1",10)
};

const { error } = await supabaseClient
  .from("shipments")
  .update(updatePayload)
  .eq("id", shipment.id);

if (error) {
  alert("Fout bij opslaan: " + error.message);
  return;
}
    loadShipments(currentUserId);
  };
}

// ---------------- create shipment
async function createShipment(user) {
  const supabaseClient = await ensureClient();
  msg("Bezig...");

  const customer_name = document.getElementById("customer_name").value.trim();
  const pickup_address = document.getElementById("pickup_address").value.trim();
  const delivery_address = document.getElementById("delivery_address").value.trim();
  const shipment_type = document.getElementById("shipment_type").value;
  const shipment_type_other = document.getElementById("shipment_type_other").value.trim() || null;
  const colli_count = parseInt(document.getElementById("colli_count").value || "1", 10);

  if (!customer_name || !pickup_address || !delivery_address) {
    msg("Vul klantnaam + ophaaladres + bezorgadres in.");
    return;
  }
  if (shipment_type === "overig" && !shipment_type_other) {
    msg("Vul 'overig' type in.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("shipments")
    .insert({
      driver_id: user.id,
      customer_name,
      pickup_address,
      delivery_address,
      shipment_type,
      shipment_type_other,
      colli_count
    })
    .select("*")
    .single();

  if (error) {
    msg("Fout: " + error.message);
    return;
  }

  msg(`Aangemaakt: ${data.track_code}`);
  await loadShipments(user.id);
}

// ---------------- init
(async () => {
  const user = await requireAuth();
  currentUserId = user.id;

  document.getElementById("btnCreate").addEventListener("click", () => createShipment(user));
  await loadShipments(user.id);

  const supabaseClient = await ensureClient();
  supabaseClient
    .channel("shipments_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, () => loadShipments(user.id))
    .subscribe();
})();
