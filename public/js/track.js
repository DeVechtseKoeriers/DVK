const codeEl = document.getElementById("code");
const btnEl = document.getElementById("btn");
const msgEl = document.getElementById("msg");

const resultEl = document.getElementById("result");
const trackcodeEl = document.getElementById("trackcode");
const statusEl = document.getElementById("status");
const pickupEl = document.getElementById("pickup");
const deliveryEl = document.getElementById("delivery");
const typeEl = document.getElementById("type");
const colliEl = document.getElementById("colli");
const receiverEl = document.getElementById("receiver");
const noteEl = document.getElementById("note");
const timelineEl = document.getElementById("timeline");
const liveEl = document.getElementById("live");

// Nieuw blok (index.html)
const afterCard = document.getElementById("afterDeliveryCard");
const afterText = document.getElementById("afterDeliveryText");

let currentShipmentId = null;
let channel = null;

function setMsg(text, kind = "muted") {
  msgEl.className = kind === "err" ? "err" : kind === "ok" ? "ok" : "muted";
  msgEl.textContent = text || "";
}

function fmt(dt) {
  try {
    const d = new Date(dt);
    return isNaN(d) ? "" : d.toLocaleString("nl-NL");
  } catch {
    return "";
  }
}

function labelStatus(s) {
  const map = {
    AANGEMAAKT: "Aangemaakt",
    OPGEHAALD: "Opgehaald",
    ONDERWEG: "Onderweg",
    AFGELEVERD: "Afgeleverd",
    PROBLEEM: "Probleem",
    GEARCHIVEERD: "Gearchiveerd",
  };
  return map[s] ||
