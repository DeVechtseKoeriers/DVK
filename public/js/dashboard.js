// DVK Dashboard (Driver) - Clean & Working (1 file)
//
// Features:
// - Tabs Active/Archived
// - Create shipment
// - Status buttons: OPGEHAALD / ONDERWEG / PROBLEEM / AFGELEVERD
// - Delivered modal with signature + photos upload
// - Timeline via "shipment_events" (NO pickup_at columns needed)
// - PDF afleverbon with logo + signature + photos + timeline at bottom

// ---------------- DOM
const listEl = document.getElementById("list");
const listArchivedEl = document.getElementById("listArchived");
const tabActive = document.getElementById("tabActive");
const tabArchived = document.getElementById("tabArchived");

// Create form
const createMsg = document.getElementById("createMsg");
const shipmentTypeEl = document.getElementById("shipment_type");
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
if (shipmentTypeEl && otherWrap) {
  shipmentTypeEl.addEventListener("change", () => {
    otherWrap.style.display = shipmentTypeEl.value === "overig" ? "block" : "none";
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

// ---------------- Update Status (robust: extra velden mogen ontbreken)
async function updateStatus(shipment, newStatus, extra = {}, eventNote = null) {
  const supabaseClient = await ensureClient();

  let err = null;
  const payload = { status: newStatus, ...extra };

  // Probeer met extra velden
  const r1 = await supabaseClient
    .from("shipments")
    .update(payload)
    .eq("id", shipment.id)
    .eq("driver_id", currentUserId);

  err = r1.error;

  // Als kolom niet bestaat -> retry alleen status
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

  // Event in tijdpad
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

// ---------------- PDF Afleverbon (LOGO + Notitie onder bezorgadres + Handtekening onder ontvanger + Tijdpad onderaan)
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

    // ===== LOGO (fix: spatie in bestandsnaam -> %20)
    // Pas dit pad aan als jouw logo anders heet/ergens anders staat.
    try {
      const logoUrl = "/DVK/images/DVK%20logo3.jpg";
      const logoBytes = await fetchBytes(logoUrl);
      const logoDataUrl = await bytesToDataUrl(logoBytes, "image/jpeg");
      doc.addImage(logoDataUrl, "JPEG", left, 10, 45, 18);
    } catch (e) {
      console.log("Logo niet geladen:", e);
    }

    // ===== Titel
    doc.setFontSize(16);
    doc.text("De Vechtse Koeriers (DVK)", left, 36);

    y = 48;
    doc.setDrawColor(0);
    doc.line(left, y, right, y);
    y += 10;

    doc.setFontSize(12);

    // ===== Basisgegevens
    const typeText =
      s.shipment_type === "overig"
        ? (s.shipment_type_other || "overig")
        : (s.shipment_type || "-");

    doc.text(`Trackcode: ${s.track_code || "-"}`, left, y); y += 8;
    doc.text(`Klant: ${s.customer_name || "-"}`, left, y); y += 8;
    doc.text(`Type: ${typeText}`, left, y); y += 8;
    doc.text(`Colli: ${s.colli_count ?? "-"}`, left, y); y += 8;
    doc.text(`Status: ${labelStatus(s.status)}`, left, y); y += 10;

    // ===== Adressen
    ensureSpace(20);
    doc.text(`Ophaaladres: ${s.pickup_address || "-"}`, left, y); y += 8;
    doc.text(`Bezorgadres: ${s.delivery_address || "-"}`, left, y); y += 10;

    // ✅ Notitie onder bezorgadres (met ruimte)
    doc.text(`Notitie: ${s.delivered_note || "-"}`, left, y); y += 12;

    // ===== Ontvanger
    doc.text(`Ontvanger: ${s.receiver_name || "-"}`, left, y); y += 10;

    // ✅ Handtekening onder ontvanger
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

    // (optioneel) Foto’s
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

          // We proberen JPEG, en als dat faalt PNG.
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

    // ===== Tijdpad helemaal onderaan (shipment_events)
    // We zetten tijdpad als LAATSTE blok; als er geen ruimte is -> nieuwe pagina.
    const events = await fetchEventsForShipment(s.id);

    // reken ruimte: titel + regels
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

        // Regel
        doc.text(`${kind}: ${when}`, left, y);
        y += 7;

        // Probleem note (als aanwezig)
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

    // Opslaan
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

    // Archiveer pas als afgeleverd
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

        // status PROBLEEM + event note
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
      status: "AANGEMAAKT",
    })
    .select("*")
    .single();

  if (error) {
    msg("Fout: " + error.message);
    return;
  }

  // Event: AANGEMAAKT (maar nooit dubbel)
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

  // ✅ formulier leegmaken
document.getElementById("customer_name").value = "";
document.getElementById("pickup_address").value = "";
document.getElementById("delivery_address").value = "";
document.getElementById("colli_count").value = "1";
document.getElementById("shipment_type").value = "doos";

const other = document.getElementById("shipment_type_other");
if (other) other.value = "";

const otherWrap = document.getElementById("otherWrap");
if (otherWrap) otherWrap.style.display = "none";
  
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

      // Signature upload
      const sigBlob = await canvasToBlob(sigCanvas);
      const sigPath = `${base}/signature.png`;
      await uploadFile(bucket, sigPath, sigBlob, "image/png");

      // Photos upload (optioneel)
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
        note // eventNote (komt in shipment_events)
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

// ================= AUTOCOMPLETE =================

function initAutocomplete() {
  const pickupInput = document.getElementById("pickup_address");
  const deliveryInput = document.getElementById("delivery_address");

  if (!google?.maps?.places) {
    console.warn("Google Places niet geladen (check script + Places API).");
    return;
  }

  // GEEN 'types' => bedrijven + adressen
  const options = {
    componentRestrictions: { country: "nl" },
  };

  function buildAddressFromComponents(components) {
    if (!components?.length) return "";

    const get = (type) =>
      components.find((c) => c.types.includes(type))?.long_name || "";

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

    input.setAttribute("autocomplete", "off");

    const ac = new google.maps.places.Autocomplete(input, options);

    // We vragen expliciet om alles wat we nodig hebben:
    // - formatted_address (meestal incl. postcode + huisnr)
    // - address_components (fallback om zelf op te bouwen)
    // - name (bedrijfsnaam)
    // - place_id (handig als je later iets wil)
    if (ac.setFields) {
      ac.setFields(["formatted_address", "address_components", "name", "place_id"]);
    }

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();

      // 1) Probeer altijd een volledig adres te maken
      let full = place?.formatted_address || buildAddressFromComponents(place?.address_components);

      // 2) Als het een bedrijf is: zet "Bedrijf, Volledig adres"
      // (Bij puur woonadres is name vaak leeg of gelijk aan straat)
      const name = (place?.name || "").trim();
      if (name) {
        // voorkom dubbel: als name al in full zit
        const lowerFull = (full || "").toLowerCase();
        const lowerName = name.toLowerCase();

        if (full && !lowerFull.includes(lowerName)) {
          input.value = `${name}, ${full}`;
        } else if (full) {
          input.value = full;
        } else {
          input.value = name; // laatste fallback
        }
      } else {
        // Geen bedrijfsnaam -> gewoon het (volledige) adres
        if (full) input.value = full;
      }
    });
  }

  attach(pickupInput);
  attach(deliveryInput);
}
window.addEventListener("load", initAutocomplete);

window.initMaps = function () {
  console.log("Google Maps geladen");
  
  // hier komt straks route logic
};

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
