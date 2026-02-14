// DVK Dashboard - delivered modal + signature + photo upload

const listEl = document.getElementById("list");
const listArchivedEl = document.getElementById("listArchived");
const tabActive = document.getElementById("tabActive");
const tabArchived = document.getElementById("tabArchived");

let currentTab = "active";
let currentDeliveryShipment = null;
let currentUserId = null;

if (tabActive) tabActive.addEventListener("click", () => setTab("active"));
if (tabArchived) tabArchived.addEventListener("click", () => setTab("archived"));

function setTab(tab) {
  currentTab = tab;

  const isActive = tab === "active";
  if (listEl) listEl.style.display = isActive ? "block" : "none";
  if (listArchivedEl) listArchivedEl.style.display = isActive ? "none" : "block";

  if (tabActive) tabActive.disabled = isActive;
  if (tabArchived) tabArchived.disabled = !isActive;
}

// ---------------- create form elements
const createMsg = document.getElementById("createMsg");
const typeEl = document.getElementById("shipment_type");
const otherWrap = document.getElementById("otherWrap");

// ---------------- modal elements
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

// ---------------- helpers
function msg(t) {
  if (createMsg) createMsg.textContent = t || "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

sync function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download mislukt: " + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

async function getSignedUrl(bucket, path, expiresInSec = 300) {
  if (!path) return null;
  const supabaseClient = await ensureClient();
  const { data, error } = await supabaseClient
    .storage
    .from(bucket)
    .createSignedUrl(path, expiresInSec);

  if (error) throw error;
  return data.signedUrl;
}

// ---------------- PDF helpers
async function bytesToDataUrl(bytes, mime = "image/png") {
  const blob = new Blob([bytes], { type: mime });
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);   // data:image/...;base64,...
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function fmt(dt) {
  try {
    const d = new Date(dt);
    return isNaN(d) ? "" : d.toLocaleString("nl-NL");
  } catch { return ""; }
}

async function generateDeliveryPdf(shipment) {
  // jsPDF (UMD) via window.jspdf.jsPDF
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("jsPDF niet gevonden. Controleer stap 1 (script-tag).");
    return;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(16);
  doc.text("Afleverbon", 14, 18);

  doc.setFontSize(10);
  doc.text(`Trackcode: ${shipment.track_code || ""}`, 14, 28);
  doc.text(`Klant: ${shipment.customer_name || ""}`, 14, 34);
  doc.text(`Ophaaladres: ${shipment.pickup_address || ""}`, 14, 40);
  doc.text(`Bezorgadres: ${shipment.delivery_address || ""}`, 14, 46);
  doc.text(`Status: ${shipment.status || ""}`, 14, 52);
  doc.text(`Ontvanger: ${shipment.receiver_name || ""}`, 14, 58);
  doc.text(`Afgeleverd op: ${fmt(shipment.delivered_at || shipment.updated_at || shipment.archived_at)}`, 14, 64);

  if (shipment.delivered_note) {
    doc.text(`Opmerking: ${shipment.delivered_note}`, 14, 72, { maxWidth: 180 });
  }

  // Afbeeldingen uit Supabase Storage (signed URLs)
  const bucket = "dvk-delivery";

  let y = 90;

  // Handtekening
  if (shipment.signature_path) {
    try {
      const sigUrl = await getSignedUrl(bucket, shipment.signature_path, 300);
      const sigBytes = await fetchBytes(sigUrl);
      const sigDataUrl = await bytesToDataUrl(sigBytes, "image/png");

      doc.setFontSize(12);
      doc.text("Handtekening:", 14, y);
      y += 4;
      doc.addImage(sigDataUrl, "PNG", 14, y, 80, 30);
      y += 38;
    } catch (e) {
      console.error(e);
      doc.text("Handtekening: (laden mislukt)", 14, y);
      y += 8;
    }
  }

  // Foto 1
  if (shipment.photo1_path) {
    try {
      const p1Url = await getSignedUrl(bucket, shipment.photo1_path, 300);
      const p1Bytes = await fetchBytes(p1Url);
      const p1DataUrl = await bytesToDataUrl(p1Bytes, "image/jpeg");

      doc.setFontSize(12);
      doc.text("Foto 1:", 14, y);
      y += 4;
      doc.addImage(p1DataUrl, "JPEG", 14, y, 90, 60);
      y += 68;
    } catch (e) {
      console.error(e);
      doc.text("Foto 1: (laden mislukt)", 14, y);
      y += 8;
    }
  }

  // Foto 2
  if (shipment.photo2_path) {
    try {
      const p2Url = await getSignedUrl(bucket, shipment.photo2_path, 300);
      const p2Bytes = await fetchBytes(p2Url);
      const p2DataUrl = await bytesToDataUrl(p2Bytes, "image/jpeg");

      doc.setFontSize(12);
      doc.text("Foto 2:", 14, y);
      y += 4;
      doc.addImage(p2DataUrl, "JPEG", 14, y, 90, 60);
      y += 68;
    } catch (e) {
      console.error(e);
      doc.text("Foto 2: (laden mislukt)", 14, y);
      y += 8;
    }
  }

  const safeCode = (shipment.track_code || "afleverbon").replace(/[^a-z0-9_-]/gi, "_");
  doc.save(`Afleverbon-${safeCode}.pdf`);
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
    otherWrap.style.display = typeEl.value === "overig" ? "block" : "none";
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

// ---------------- events timeline (optioneel)
async function addEvent(shipmentId, eventType, note = null) {
  const supabaseClient = await ensureClient();
  const { error } = await supabaseClient
    .from("shipment_events")
    .insert({ shipment_id: shipmentId, event_type: eventType, note });
  if (error) console.error("event insert error:", error);
}

// ---------------- list
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
    if (listEl) listEl.innerHTML = "<small>Geen zendingen.</small>";
    return;
  }

  const active = [];
  const archived = [];
  for (const s of data) {
    if (s.archived_at) archived.push(s);
    else active.push(s);
  }

  if (listEl) {
    if (active.length === 0) listEl.innerHTML = "<small>Geen actieve zendingen.</small>";
    else for (const s of active) listEl.appendChild(renderShipmentCard(s));
  }

  if (listArchivedEl) {
    if (archived.length === 0) listArchivedEl.innerHTML = "<small>Geen gearchiveerde zendingen.</small>";
    else for (const s of archived) listArchivedEl.appendChild(renderShipmentCard(s));
  }
}

// ---------------- update status (FIXED: sluit netjes af)
async function updateStatus(shipment, newStatus, extra = {}) {
  const supabaseClient = await ensureClient();

  const { error } = await supabaseClient
    .from("shipments")
    .update({ status: newStatus, ...extra })
    .eq("id", shipment.id)
    .eq("driver_id", currentUserId);

  if (error) {
    alert("Update fout: " + error.message);
    return false;
  }

  // optioneel eventlog
  try {
    const eventNote = extra.problem_note || extra.delivered_note || extra.archive_note || null;
    await addEvent(shipment.id, newStatus, eventNote);
  } catch (e) {
    // niet blokkerend
  }

  await loadShipments(currentUserId);
  return true;
}

// ---------------- definitief verwijderen (1 plek, geen dubbele delete functies)
async function deleteShipment(shipment) {
  const ok = confirm(
    `Weet je zeker dat je zending ${shipment.track_code} wilt verwijderen?\n\nDit kan niet ongedaan gemaakt worden.`
  );
  if (!ok) return false;

  const supabaseClient = await ensureClient();

  // Laat Supabase teruggeven wat er verwijderd is
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
    alert("Niet verwijderd. Waarschijnlijk RLS/geen rechten of driver_id mismatch.");
    return false;
  }

  await loadShipments(currentUserId);
  return true;
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

  const typeText =
    shipment.shipment_type === "overig"
      ? (shipment.shipment_type_other || "overig")
      : shipment.shipment_type;

  modalShipmentInfo.innerHTML = `
    <b>${escapeHtml(shipment.track_code)}</b><br/>
    ${escapeHtml(shipment.pickup_address)} → ${escapeHtml(shipment.delivery_address)}<br/>
    <span class="small">Type: ${escapeHtml(typeText)} • Colli: ${shipment.colli_count}</span>
  `;

  overlay.style.display = "flex";

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

if (modalCancel) modalCancel.addEventListener("click", closeDeliveredModal);
if (overlay) {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDeliveredModal();
  });
}

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

if (modalConfirm) {
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

      const sigBlob = await canvasToBlob(sigCanvas);
      const sigPath = `${base}/signature.png`;
      await uploadFile(bucket, sigPath, sigBlob, "image/png");

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
}

// ---------------- card render
function renderShipmentCard(s) {
  const div = document.createElement("div");
  div.className = "shipment";

  const typeText =
    s.shipment_type === "overig"
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

  // Alleen acties als NIET gearchiveerd
  if (!s.archived_at) {
    actions.append(button("Wijzigen", () => openEditMode(div, s)));
    actions.append(button("Verwijderen", async () => deleteShipment(s)));

    if (s.status === "AFGELEVERD") {
      actions.append(
        button("Archiveer", async () => {
          await updateStatus(s, "GEARCHIVEERD", {
            archived_at: new Date().toISOString()
          });
          if (typeof setTab === "function") setTab("archived");
        })
      );
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
  } else {
    // In archief alleen verwijderen (optioneel)
    actions.append(button("Verwijderen", async () => deleteShipment(s)));
  }

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

  const editType = form.querySelector("#editType");
  const editOtherWrap = form.querySelector("#editOtherWrap");
  const editOther = form.querySelector("#editOther");

  if (editType) editType.value = shipment.shipment_type || "doos";

  function toggleOther() {
    const isOther = editType && editType.value === "overig";
    if (editOtherWrap) editOtherWrap.style.display = isOther ? "block" : "none";
  }
  toggleOther();
  if (editType) editType.addEventListener("change", toggleOther);
  if (editOther && shipment.shipment_type_other) editOther.value = shipment.shipment_type_other;

  cardDiv.appendChild(form);

  form.querySelector("#cancelEdit").onclick = () => loadShipments(currentUserId);

  form.querySelector("#saveEdit").onclick = async () => {
    const supabaseClient = await ensureClient();

    const selectedType = editType?.value || "doos";
    const otherValue = (editOther?.value || "").trim() || null;

    const updatePayload = {
      customer_name: form.querySelector("#editCustomer")?.value || "",
      pickup_address: form.querySelector("#editPickup")?.value || "",
      delivery_address: form.querySelector("#editDelivery")?.value || "",
      shipment_type: selectedType,
      shipment_type_other: selectedType === "overig" ? otherValue : null,
      colli_count: parseInt(form.querySelector("#editColli")?.value || "1", 10)
    };

    const { error } = await supabaseClient
      .from("shipments")
      .update(updatePayload)
      .eq("id", shipment.id)
      .eq("driver_id", currentUserId);

    if (error) {
      alert("Fout bij opslaan: " + error.message);
      return;
    }

    await loadShipments(currentUserId);
  };
}

// ---------------- create shipment (FIXED: gebruikt currentUserId)
async function createShipment() {
  const supabaseClient = await ensureClient();
  msg("Bezig...");

  const customer_name = document.getElementById("customer_name")?.value.trim() || "";
  const pickup_address = document.getElementById("pickup_address")?.value.trim() || "";
  const delivery_address = document.getElementById("delivery_address")?.value.trim() || "";
  const shipment_type = document.getElementById("shipment_type")?.value || "doos";
  const shipment_type_other = document.getElementById("shipment_type_other")?.value.trim() || null;
  const colli_count = parseInt(document.getElementById("colli_count")?.value || "1", 10);

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
      driver_id: currentUserId,
      customer_name,
      pickup_address,
      delivery_address,
      shipment_type,
      shipment_type_other: shipment_type === "overig" ? shipment_type_other : null,
      colli_count
    })
    .select("*")
    .single();

  if (error) {
    msg("Fout: " + error.message);
    return;
  }

  msg(`Aangemaakt: ${data.track_code}`);
  await loadShipments(currentUserId);
}

// ---------------- init
(async () => {
  const user = await requireAuth();
  currentUserId = user.id;

  const btn = document.getElementById("btnCreate");
  if (btn) {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await createShipment();
    });
  }

  await loadShipments(currentUserId);

  const supabaseClient = await ensureClient();
  supabaseClient
    .channel("shipments_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments" },
      () => loadShipments(currentUserId)
    )
    .subscribe();
})();
