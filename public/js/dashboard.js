// DVK Dashboard (Driver) - Clean & Working (1 file)
//
// Features:
// - Tabs Active/Archived
// - Create shipment
// - Status buttons + Delivered modal
// - Timeline via shipment_events
// - PDF afleverbon
// - Google Places Autocomplete (bedrijven + adressen)
// - Routeplanner + kaart (optimal route + auto reroute)

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
  const autoRouteEl = document.getElementById("autoRoute");
  const routeMsgEl = document.getElementById("routeMsg");
  const routeListEl = document.getElementById("routeList");
  const mapEl = document.getElementById("map");

  // ---------------- STATE
  let currentTab = "active";
  let currentDeliveryShipment = null;
  let currentUserId = null;

  // cache voor routeplanner
  let activeShipmentsCache = [];

  // depot / start-eindpunt
  const DEPOT_ADDRESS = "Vecht en Gein 28, 1393 PZ Nigtevecht, Nederland";

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
      if (listEl) listEl.innerHTML = "<small>Geen zendingen.</small>";
      return;
    }

    const active = [];
    const archived = [];
    for (const s of data) {
      if (s.archived_at) archived.push(s);
      else active.push(s);
    }

    // ✅ cache voor routeplanner
    activeShipmentsCache = active;

    if (listEl) {
      if (active.length === 0) listEl.innerHTML = "<small>Geen actieve zendingen.</small>";
      else for (const s of active) listEl.appendChild(renderShipmentCard(s));
    }

    if (listArchivedEl) {
      if (archived.length === 0) listArchivedEl.innerHTML = "<small>Geen gearchiveerde zendingen.</small>";
      else for (const s of archived) listArchivedEl.appendChild(renderShipmentCard(s));
    }

    // ✅ auto reroute als checkbox aan staat
    if (autoRouteEl?.checked) {
      // route alleen berekenen als maps al klaar is
      if (window.__dvkMapsReady) {
        planOptimalRoute();
      }
    }
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

      ensureSpace(20);
      doc.text(`Ophaaladres: ${s.pickup_address || "-"}`, left, y); y += 8;
      doc.text(`Bezorgadres: ${s.delivery_address || "-"}`, left, y); y += 10;

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

    if (s.archived_at) {
      actions.append(
        button("Afleverbon (PDF)", async () => {
          await generateDeliveryPdf(s);
        })
      );
    }

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

    // formulier leegmaken
    document.getElementById("customer_name").value = "";
    document.getElementById("pickup_address").value = "";
    document.getElementById("delivery_address").value = "";
    document.getElementById("colli_count").value = "1";
    document.getElementById("shipment_type").value = "doos";

    const other = document.getElementById("shipment_type_other");
    if (other) other.value = "";

    const wrap = document.getElementById("otherWrap");
    if (wrap) wrap.style.display = "none";

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
    const pickupInput = document.getElementById("pickup_address");
    const deliveryInput = document.getElementById("delivery_address");

    if (!pickupInput && !deliveryInput) return;

    if (!window.google?.maps?.places?.Autocomplete) {
      console.warn("Google Places Autocomplete niet beschikbaar (check libraries=places).");
      return;
    }

    // GEEN types => bedrijven + adressen
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

      // fields
      if (ac.setFields) {
        ac.setFields(["formatted_address", "address_components", "name", "place_id"]);
      }

      ac.addListener("place_changed", () => {
        const place = ac.getPlace();

        let full = place?.formatted_address || buildAddressFromComponents(place?.address_components);
        const name = (place?.name || "").trim();

        if (name) {
          const lowerFull = (full || "").toLowerCase();
          const lowerName = name.toLowerCase();

          if (full && !lowerFull.includes(lowerName)) {
            input.value = `${name}, ${full}`;
          } else if (full) {
            input.value = full;
          } else {
            input.value = name;
          }
        } else {
          if (full) input.value = full;
        }
      });
    }

    attach(pickupInput);
    attach(deliveryInput);
  }

  // ================= ROUTEPLANNER + MAP =================
  let map;
  let directionsService;
  let directionsRenderer;

  function clearRouteList() {
    if (!routeListEl) return;
    routeListEl.innerHTML = "";
  }

  function setRouteList(items) {
    if (!routeListEl) return;
    routeListEl.innerHTML = "";

    const title = document.createElement("div");
    title.innerHTML = "<b>Optimale volgorde:</b>";
    routeListEl.appendChild(title);

    items.forEach((t, idx) => {
      const row = document.createElement("div");
      row.textContent = `${idx + 1}. ${t}`;
      routeListEl.appendChild(row);
    });
  }

 // ================= ROUTEPLANNER (LOGISCH: pickup vóór delivery, eindigt nooit met pickup) =================

const BASE_ADDRESS = "Vecht en Gein 28, 1393 PZ Nigtevecht, Nederland";

const btnPlanRoute = document.getElementById("btnPlanRoute");
const autoRouteEl = document.getElementById("autoRoute");
const routeMsgEl = document.getElementById("routeMsg");
const routeListEl = document.getElementById("routeList");
const mapEl = document.getElementById("map");

let map = null;
let directionsService = null;
let directionsRenderer = null;

// Helper
function setRouteMsg(t) {
  if (routeMsgEl) routeMsgEl.textContent = t || "";
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
    row.textContent = `${i + 1}. ${s.label}`;
    routeListEl.appendChild(row);
  });
}

function buildStopsFromActiveShipments() {
  // verwacht dat jij ergens al een cache hebt zoals activeShipmentsCache
  // (in jouw code is die er al, want je routeplanner werkt).
  const stops = [];

  for (const s of (window.activeShipmentsCache || [])) {
    // sla gearchiveerd over
    if (s.archived_at) continue;

    const p = (s.pickup_address || "").trim();
    const d = (s.delivery_address || "").trim();
    if (!p || !d) continue;

    const pickId = `P:${s.id}`;
    const delId  = `D:${s.id}`;

    stops.push({
      id: pickId,
      shipmentId: s.id,
      type: "pickup",
      addr: p,
      label: `Ophalen: ${p} (${s.track_code || ""})`,
    });

    stops.push({
      id: delId,
      shipmentId: s.id,
      type: "delivery",
      addr: d,
      label: `Bezorgen: ${d} (${s.track_code || ""})`,
    });
  }

  return stops;
}

function ensureMapsReady() {
  if (!window.google?.maps) {
    throw new Error("Google Maps API niet geladen.");
  }
}

function ensureMapInit() {
  ensureMapsReady();

  if (!map && mapEl) {
    map = new google.maps.Map(mapEl, {
      zoom: 9,
      center: { lat: 52.27, lng: 5.07 }, // regio Nigtevecht
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

// Bouw 1x een reistijdmatrix voor greedy keuze
async function buildTimeMatrix(addresses) {
  // addresses: [BASE, ...stopsAddrs]
  ensureMapsReady();
  const svc = new google.maps.DistanceMatrixService();

  // DistanceMatrix limieten: houd het praktisch klein (jij hebt meestal < 20 stops)
  return await new Promise((resolve, reject) => {
    svc.getDistanceMatrix(
      {
        origins: addresses,
        destinations: addresses,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
        avoidTolls: false,
        avoidHighways: false,
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

// Greedy route met constraint: delivery pas na pickup
async function computeOrderedStopsGreedy(stops) {
  if (!stops.length) return [];

  // index mapping
  const addrs = [BASE_ADDRESS, ...stops.map(s => s.addr)];
  const matrix = await buildTimeMatrix(addrs);

  const donePickups = new Set();      // shipmentId waarvoor pickup gedaan is
  const remaining = new Map();        // stopId -> stop
  stops.forEach(s => remaining.set(s.id, s));

  let currentIndex = 0; // start bij BASE in matrix

  const ordered = [];

  while (remaining.size > 0) {
    // Kandidaten: alle pickups + deliveries waarvan pickup al gedaan
    const candidates = [];
    for (const s of remaining.values()) {
      if (s.type === "pickup") candidates.push(s);
      if (s.type === "delivery" && donePickups.has(s.shipmentId)) candidates.push(s);
    }

    // Safety: als er geen candidates zijn, zit data scheef -> break
    if (!candidates.length) {
      // fallback: gooi alles erin (maar in praktijk gebeurt dit niet)
      for (const s of remaining.values()) candidates.push(s);
    }

    // Kies kandidaat met kleinste reistijd vanaf currentIndex
    let best = null;
    let bestCost = Number.POSITIVE_INFINITY;

    for (const c of candidates) {
      const cIndex = 1 + stops.findIndex(x => x.id === c.id); // matrix index
      const cost = getDurationSeconds(matrix, currentIndex, cIndex);

      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }

    // apply
    ordered.push(best);
    remaining.delete(best.id);

    // mark pickup done
    if (best.type === "pickup") donePickups.add(best.shipmentId);

    // move current
    currentIndex = 1 + stops.findIndex(x => x.id === best.id);
  }

  // ✅ Garantie: laatste stop vóór terugkeer is een delivery (als er deliveries bestaan)
  // (Normaal al zo, maar we forceren het even hard.)
  const lastIsDelivery = ordered.length ? ordered[ordered.length - 1].type === "delivery" : true;
  if (!lastIsDelivery) {
    const lastDeliveryIdx = [...ordered].map((s,i)=>({s,i})).reverse().find(x=>x.s.type==="delivery")?.i;
    if (lastDeliveryIdx != null) {
      const del = ordered.splice(lastDeliveryIdx, 1)[0];
      ordered.push(del);
    }
  }

  return ordered;
}

async function drawRouteOnMap(orderedStops) {
  ensureMapInit();

  const waypoints = orderedStops.map(s => ({
    location: s.addr,
    stopover: true,
  }));

  // Belangrijk: optimizeWaypoints UIT, anders haalt Google jouw logica onderuit.
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

async function planOptimalRoute() {
  try {
    setRouteMsg("Route berekenen...");
    clearRouteList();

    const stops = buildStopsFromActiveShipments();

    if (!stops.length) {
      setRouteMsg("Geen actieve zendingen voor routeplanning.");
      return;
    }

    const ordered = await computeOrderedStopsGreedy(stops);

    // Laat in de lijst alleen de stops zien (zonder start/eind)
    renderRouteList(ordered);

    // teken op kaart
    await drawRouteOnMap(ordered);

    // bericht
    setRouteMsg(`Route klaar • ${ordered.length} stops • start/eind: Nigtevecht`);
  } catch (e) {
    console.error(e);
    setRouteMsg("Route fout: " + (e?.message || e));
  }
}

// Button + auto recalculatie
if (btnPlanRoute) {
  btnPlanRoute.addEventListener("click", () => planOptimalRoute());
}

// Als jij realtime updates gebruikt: roep planOptimalRoute aan bij updates (als checkbox aan staat)
async function maybeAutoRecalcRoute() {
  if (!autoRouteEl?.checked) return;
  // kleine debounce (voorkomt spam bij meerdere updates)
  clearTimeout(window.__dvkRouteTimer);
  window.__dvkRouteTimer = setTimeout(() => planOptimalRoute(), 400);
}

// Maak deze beschikbaar zodat je hem kunt aanroepen vanuit jouw realtime shipment refresh
window.__dvkMaybeAutoRecalcRoute = maybeAutoRecalcRoute;

// Callback van Google script
window.initMaps = function () {
  console.log("Google Maps geladen");
  try {
    ensureMapInit();
  } catch (e) {
    console.error(e);
  }
}

  // ✅ callback van Google Maps script (callback=initMaps)
  window.initMaps = function () {
    try {
      console.log("Google Maps geladen");
      window.__dvkMapsReady = true;

      // init map
      if (mapEl) {
        map = new google.maps.Map(mapEl, {
          zoom: 9,
          center: { lat: 52.27, lng: 5.07 }, // regio Nigtevecht
        });

        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: false,
        });

        // Autocomplete pas starten als Places er is
        initAutocomplete();

        // Als auto-route aan staat, direct plannen (als er al zendingen geladen zijn)
        if (autoRouteEl?.checked) {
          planOptimalRoute();
        }
      } else {
        console.warn("map element (#map) ontbreekt in HTML.");
      }
    } catch (e) {
      console.error("initMaps error:", e);
    }
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
})();
