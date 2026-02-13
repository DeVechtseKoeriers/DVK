// DVK Dashboard (Delivered modal version)

const listEl = document.getElementById("list");
const createMsg = document.getElementById("createMsg");
const typeEl = document.getElementById("shipment_type");
const otherWrap = document.getElementById("otherWrap");

const overlay = document.getElementById("modalOverlay");
const modalShipmentInfo = document.getElementById("modalShipmentInfo");
const modalReceiver = document.getElementById("modalReceiver");
const modalNote = document.getElementById("modalNote");
const modalError = document.getElementById("modalError");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");

let currentDeliveryShipment = null;

function msg(text) {
  if (createMsg) createMsg.textContent = text || "";
}

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

if (typeEl && otherWrap) {
  typeEl.addEventListener("change", () => {
    otherWrap.style.display = (typeEl.value === "overig") ? "block" : "none";
  });
}

// Logout
const logoutBtn = document.getElementById("btnLogout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    const supabaseClient = await ensureClient();
    await supabaseClient.auth.signOut();
    window.location.href = "/DVK/driver/login.html";
  });
}

async function addEvent(shipmentId, eventType, note = null) {
  const supabaseClient = await ensureClient();
  const { error } = await supabaseClient
    .from("shipment_events")
    .insert({ shipment_id: shipmentId, event_type: eventType, note });
  if (error) console.error("event insert error:", error);
}

async function loadShipments(driverId) {
  const supabaseClient = await ensureClient();
  if (!listEl) return;

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

  for (const s of data) {
    listEl.appendChild(renderShipmentCard(s));
  }
}

async function updateStatus(shipment, newStatus, extra = {}) {
  const supabaseClient = await ensureClient();

  const patch = { status: newStatus, ...extra };

  const { error } = await supabaseClient
    .from("shipments")
    .update(patch)
    .eq("id", shipment.id);

  if (error) {
    alert("Update fout: " + error.message);
    return;
  }

  const eventNote =
    extra.problem_note || extra.delivered_note || extra.archive_note || null;

  await addEvent(shipment.id, newStatus, eventNote);
  await loadShipments(shipment.driver_id);
}

function button(text, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function openDeliveredModal(shipment) {
  currentDeliveryShipment = shipment;

  modalError.textContent = "";
  modalReceiver.value = "";
  modalNote.value = "";

  const typeText =
    (shipment.shipment_type === "overig")
      ? (shipment.shipment_type_other || "overig")
      : shipment.shipment_type;

  modalShipmentInfo.innerHTML = `
    <b>${escapeHtml(shipment.track_code)}</b><br/>
    ${escapeHtml(shipment.pickup_address)} → ${escapeHtml(shipment.delivery_address)}<br/>
    <span class="small">Type: ${escapeHtml(typeText)} • Colli: ${shipment.colli_count}</span>
  `;

  overlay.style.display = "flex";
  setTimeout(() => modalReceiver.focus(), 50);
}

function closeDeliveredModal() {
  overlay.style.display = "none";
  currentDeliveryShipment = null;
}

modalCancel.addEventListener("click", closeDeliveredModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeDeliveredModal();
});

modalConfirm.addEventListener("click", async () => {
  if (!currentDeliveryShipment) return;

  const receiver = modalReceiver.value.trim();
  const note = modalNote.value.trim() || null;

  if (!receiver) {
    modalError.textContent = "Naam ontvanger is verplicht.";
    modalReceiver.focus();
    return;
  }

  modalConfirm.disabled = true;
  modalError.textContent = "";

  try {
    await updateStatus(currentDeliveryShipment, "AFGELEVERD", {
      receiver_name: receiver,
      delivered_note: note
    });
    closeDeliveredModal();
  } finally {
    modalConfirm.disabled = false;
  }
});

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

  actions.append(
    button("Opgehaald", () => updateStatus(s, "OPGEHAALD")),
    button("Onderweg", () => updateStatus(s, "ONDERWEG")),
    button("Probleem", async () => {
      const note = prompt("Wat is het probleem?");
      if (!note) return;
      await updateStatus(s, "PROBLEEM", { problem_note: note });
    }),
    button("Afgeleverd", () => openDeliveredModal(s)),
    button("Archiveren", async () => {
      const note = prompt("Archief notitie (optioneel):") || null;
      await updateStatus(s, "GEARCHIVEERD", {
        archived_at: new Date().toISOString(),
        archive_note: note
      });
    })
  );

  if (s.problem_note) sub.innerHTML = `<small><b>Probleem:</b> ${escapeHtml(s.problem_note)}</small>`;
  if (s.receiver_name) sub.innerHTML += `<br/><small><b>Ontvanger:</b> ${escapeHtml(s.receiver_name)}</small>`;

  return div;
}

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

  const payload = {
    driver_id: user.id,
    customer_name,
    pickup_address,
    delivery_address,
    shipment_type,
    shipment_type_other,
    colli_count
  };

  const { data, error } = await supabaseClient
    .from("shipments")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    msg("Fout: " + error.message);
    return;
  }

  msg(`Aangemaakt: ${data.track_code}`);
  await loadShipments(user.id);
}

(async () => {
  const user = await requireAuth();

  const btnCreate = document.getElementById("btnCreate");
  if (btnCreate) btnCreate.addEventListener("click", () => createShipment(user));

  await loadShipments(user.id);

  // realtime refresh (optioneel)
  const supabaseClient = await ensureClient();
  supabaseClient
    .channel("shipments_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, () => loadShipments(user.id))
    .subscribe();
})();
