// DVK Dashboard (Driver) - Clean & Working
// - Tabs Active/Archived
// - Create shipment
// - Status buttons: OPGEHAALD / ONDERWEG / PROBLEEM / AFGELEVERD
// - Delivered modal with signature + photos upload
// - Timeline via "shipment_events" (NO pickup_at columns needed)
// - PDF afleverbon with logo + timeline + problem note

// ---------------- DOM
const listEl = document.getElementById("list");
const listArchivedEl = document.getElementById("listArchived");
const tabActive = document.getElementById("tabActive");
const tabArchived = document.getElementById("tabArchived");

// Create form
const createMsg = document.getElementById("createMsg");
const typeEl = document.getElementById("shipment_type");
const otherWrap = document.getElementById("otherWrap");

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

// ---------------- STATE
let currentTab = "active";
let currentDeliveryShipment = null;
let currentUserId = null;

// ---------------- UI Helpers
function msg(t) {
  if (createMsg) createMsg.textContent = t || "";
}

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
if (typeEl && otherWrap) {
  typeEl.addEventListener("change", () => {
    otherWrap.style.display = typeEl.value === "overig" ? "block" : "none";
  });
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

  if (modalShipmentInfo) {
    modalShipmentInfo.innerHTML = `
      <b>${escapeHtml(shipment.track_code)}</b><br/>
      ${escapeHtml(shipment.pickup_address)} → ${escapeHtml(shipment.delivery_address)}<br/>
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

// ---------------- Timeline (shipment_events)
async function addEvent(shipmentId, eventType, note = null) {
  const supabaseClient = await ensureClient();
  // event_type voorbeelden: OPGEHAALD, ONDERWEG, AFGELEVERD, PROBLEEM
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

// ---------------- Update Status (WORKING)
async function updateStatus(shipment, newStatus, extra = {}, eventNote = null) {
  const supabaseClient = await ensureClient();

  // 1) Update shipment.status (en optioneel extra velden)
  //    -> Als extra kolom niet bestaat, proberen we opnieuw zonder extra zodat het niet crasht.
  let err = null;

  const payload = { status: newStatus, ...extra };

  // Probeer met extra
  const r1 = await supabaseClient
    .from("shipments")
    .update(payload)
    .eq("id", shipment.id)
    .eq("driver_id", currentUserId);

  err = r1.error;

  // Als error over "column not found" gaat: retry zonder extra (alleen status)
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

  // 2) Schrijf event in tijdpad (shipment_events)
  try {
    await addEvent(shipment.id, newStatus, eventNote);
  } catch (e) {
    console.error("addEvent failed:", e);
  }

  // 3) Refresh
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

async function generateDeliveryPdf(s) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("jsPDF is niet geladen.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    let y = 20; // startpositie

    // ===== Titel =====
    doc.setFontSize(16);
    doc.text("De Vechtse Koeriers (DVK)", 20, y);
    y += 12;

    doc.setFontSize(12);

    // ===== Basisgegevens =====
    doc.text(`Trackcode: ${s.track_code}`, 20, y); y += 8;
    doc.text(`Klant: ${s.customer_name || "-"}`, 20, y); y += 8;
    doc.text(`Type: ${s.shipment_type || "-"}`, 20, y); y += 8;
    doc.text(`Colli: ${s.colli_count ?? "-"}`, 20, y); y += 8;
    doc.text(`Status: ${s.status}`, 20, y); y += 12;

    // ===== Adressen =====
    doc.text(`Ophaaladres: ${s.pickup_address || "-"}`, 20, y);
    y += 8;

    doc.text(`Bezorgadres: ${s.delivery_address || "-"}`, 20, y);
    y += 10;

    // ===== Notitie ONDER bezorgadres =====
    doc.text(`Notitie: ${s.delivered_note || "-"}`, 20, y);
    y += 15;

    // ===== Ontvanger =====
    doc.text(`Ontvanger: ${s.receiver_name || "-"}`, 20, y);
    y += 10;

    // ===== Handtekening ONDER ontvanger =====
    doc.text("Handtekening:", 20, y);
    y += 5;

    if (s.signature_data_url) {
      doc.addImage(s.signature_data_url, "PNG", 20, y, 60, 25);
      y += 30;
    } else {
      y += 20;
    }

    y += 10;

    // ===== Tijdpad helemaal onderaan =====
    doc.setFontSize(14);
    doc.text("Tijdpad", 20, y);
    y += 10;

    doc.setFontSize(12);

    if (s.pickup_at) {
      doc.text(`Opgehaald: ${new Date(s.pickup_at).toLocaleString("nl-NL")}`, 20, y);
      y += 8;
    }

    if (s.on_the_way_at) {
      doc.text(`Onderweg: ${new Date(s.on_the_way_at).toLocaleString("nl-NL")}`, 20, y);
      y += 8;
    }

    if (s.delivered_at) {
      doc.text(`Afgeleverd: ${new Date(s.delivered_at).toLocaleString("nl-NL")}`, 20, y);
      y += 8;
    }

    if (s.problem_note) {
      y += 5;
      doc.text(`Probleem: ${s.problem_note}`, 20, y);
    }

    // ===== Opslaan =====
    doc.save(`Afleverbon-${s.track_code}.pdf`);

  } catch (err) {
    console.error(err);
    alert("PDF maken mislukt: " + err.message);
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

  div.innerHTML = `
    <div>
      <strong>${escapeHtml(s.track_code)}</strong> — ${escapeHtml(s.customer_name)}<br/>
      <small>${escapeHtml(s.pickup_address)} → ${escapeHtml(s.delivery_address)}</small><br/>
      <small>Type: ${escapeHtml(typeText)} • Colli: ${s.colli_count ?? ""} • Status: <b>${escapeHtml(s.status)}</b></small><br/>
      <small>Track & Trace: <a href="${trackLink}" target="_blank">${trackLink}</a></small>
      <div class="actions"></div>
      <div class="sub"></div>
    </div>
  `;

  const actions = div.querySelector(".actions");
  const sub = div.querySelector(".sub");

  // In archief: PDF knop
  if (s.archived_at) {
    actions.append(
      button("Afleverbon (PDF)", async () => {
        await generateDeliveryPdf(s);
      })
    );
  }

  // Niet gearchiveerd: acties
  if (!s.archived_at) {
    actions.append(button("Verwijderen", async () => deleteShipment(s)));

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

        // status PROBLEEM + event note opslaan
        // extra (problem_note) proberen we mee te geven, maar als kolom niet bestaat crasht het niet
        await updateStatus(s, "PROBLEEM", { problem_note: note }, note);
      }),
      button("Afgeleverd", () => openDeliveredModal(s))
    );
  } else {
    // Archief: eventueel verwijderen
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
      colli_count,
      status: "AANGEMAAKT"
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
          photo2_path: p2
        },
        note // eventNote
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

// ---------------- INIT
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

  setTab("active");
  await loadShipments(currentUserId);

  // Realtime refresh
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
