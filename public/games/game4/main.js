const steps = [
  { id: "wash-self", label: "Wash your own hair", done: () => state.selfWashed },
  {
    id: "wash-client",
    label: "Choose a client and wash their hair",
    done: () => state.selectedClient !== null && state.clientWashed,
  },
  {
    id: "style",
    label: "Do all three style moves: cut, shape, accessory",
    done: () => state.completedStyles.size >= 3,
  },
  {
    id: "color",
    label: "Finish with a color on the ends",
    done: () => state.colorApplied,
  },
];

const state = {
  selfWashed: false,
  selectedClient: null,
  clientWashed: false,
  completedStyles: new Set(),
  colorApplied: false,
};

const elements = {
  stepList: document.getElementById("stepList"),
  statusPill: document.getElementById("statusPill"),
  washSelfBtn: document.getElementById("washSelfBtn"),
  washClientBtn: document.getElementById("washClientBtn"),
  clientChips: document.querySelectorAll('button[data-client], .avatar[data-client]'),
  styleButtons: document.querySelectorAll("button[data-style]"),
  colorPicker: document.getElementById("colorPicker"),
  applyColorBtn: document.getElementById("applyColorBtn"),
  colorSwatch: document.getElementById("colorSwatch"),
  logList: document.getElementById("logList"),
  avatarCards: document.querySelectorAll(".avatar"),
  resetBtn: document.getElementById("resetBtn"),
  boyHair: document.getElementById("boyHair"),
  girlHair: document.getElementById("girlHair"),
};

const baseHairColors = {
  boy: getComputedStyle(document.documentElement).getPropertyValue("--hair-boy").trim() || "#3b4a6b",
  girl: getComputedStyle(document.documentElement).getPropertyValue("--hair-girl").trim() || "#5f3f6d",
};

function renderSteps() {
  elements.stepList.innerHTML = "";
  steps.forEach((step) => {
    const done = step.done();
    const li = document.createElement("li");
    li.className = "step";
    const label = document.createElement("span");
    label.textContent = step.label;
    const badge = document.createElement("span");
    badge.className = `badge ${done ? "done" : "todo"}`;
    badge.textContent = done ? "Done" : "To do";
    li.append(label, badge);
    elements.stepList.appendChild(li);
  });
  updateStatusPill();
  updateControls();
}

function updateStatusPill() {
  const next = steps.find((step) => !step.done());
  elements.statusPill.textContent = next
    ? `Next: ${next.label}`
    : "All steps complete! Your chair is ready for the next client.";
}

function updateControls() {
  elements.washSelfBtn.disabled = state.selfWashed;
  elements.washClientBtn.disabled = !state.selectedClient || state.clientWashed;
  elements.styleButtons.forEach((btn) => {
    const key = btn.dataset.style;
    btn.disabled = !state.clientWashed;
    btn.classList.toggle("active", state.completedStyles.has(key));
  });
  elements.applyColorBtn.disabled = !state.clientWashed || state.completedStyles.size < 3;
  elements.colorSwatch.style.background = elements.colorPicker.value;
  elements.avatarCards.forEach((card) => {
    const isActive = card.dataset.client === state.selectedClient;
    card.classList.toggle("active", isActive);
  });
}

function logAction(message) {
  const li = document.createElement("li");
  li.textContent = message;
  elements.logList.prepend(li);
  const items = elements.logList.querySelectorAll("li");
  if (items.length > 7) {
    elements.logList.removeChild(items[items.length - 1]);
  }
}

function washSelf() {
  if (state.selfWashed) return;
  state.selfWashed = true;
  logAction("You washed your own hair. Ready to meet a client.");
  renderSteps();
}

function chooseClient(client) {
  if (!client) return;
  const wasDifferent = state.selectedClient && state.selectedClient !== client;
  state.selectedClient = client;
  state.clientWashed = wasDifferent ? false : state.clientWashed;
  state.completedStyles = wasDifferent ? new Set() : state.completedStyles;
  state.colorApplied = wasDifferent ? false : state.colorApplied;
  logAction(`Client chosen: ${client === "boy" ? "Boy" : "Girl"}.`);
  highlightChip(client);
  renderSteps();
}

function highlightChip(client) {
  elements.clientChips.forEach((el) => {
    if (!el.dataset.client) return;
    el.classList.toggle("active", el.dataset.client === client);
  });
}

function washClient() {
  if (!state.selectedClient) {
    logAction("Pick a client first.");
    return;
  }
  if (!state.selfWashed) {
    logAction("Wash your own hair before washing the client.");
    return;
  }
  state.clientWashed = true;
  logAction(`You washed the ${state.selectedClient}'s hair. Clean and ready.`);
  renderSteps();
}

function styleHair(styleKey) {
  if (!state.clientWashed) {
    logAction("Wash the client's hair first.");
    return;
  }
  state.completedStyles.add(styleKey);
  const labels = { cut: "cut", shape: "shape", accessory: "accessory" };
  logAction(`Style move: ${labels[styleKey]}. (${state.completedStyles.size}/3 done)`);
  renderSteps();
}

function applyColor() {
  if (!state.clientWashed) {
    logAction("Wash the client's hair first.");
    return;
  }
  if (state.completedStyles.size < 3) {
    logAction("Do all three style moves before coloring.");
    return;
  }
  if (!state.selectedClient) {
    logAction("Pick a client to color their hair.");
    return;
  }
  const color = elements.colorPicker.value;
  state.colorApplied = true;
  paintHair(state.selectedClient, color);
  logAction(`Color applied to the ends: ${color}`);
  renderSteps();
}

function paintHair(client, color) {
  const hairEl = client === "boy" ? elements.boyHair : elements.girlHair;
  const base = baseHairColors[client] || "#3b4a6b";
  if (hairEl) {
    hairEl.style.background = `linear-gradient(${base} 55%, ${color})`;
  }
}

function resetHair() {
  elements.boyHair.style.background = baseHairColors.boy;
  elements.girlHair.style.background = baseHairColors.girl;
}

function resetGame() {
  state.selfWashed = false;
  state.selectedClient = null;
  state.clientWashed = false;
  state.completedStyles = new Set();
  state.colorApplied = false;
  elements.logList.innerHTML = "";
  highlightChip(null);
  resetHair();
  logAction("Game reset. Start with washing your own hair.");
  renderSteps();
}

function wireEvents() {
  elements.washSelfBtn.addEventListener("click", washSelf);
  elements.washClientBtn.addEventListener("click", washClient);
  elements.clientChips.forEach((btn) => {
    btn.addEventListener("click", () => chooseClient(btn.dataset.client));
  });
  elements.avatarCards.forEach((card) => {
    card.addEventListener("click", () => chooseClient(card.dataset.client));
  });
  elements.styleButtons.forEach((btn) => {
    btn.addEventListener("click", () => styleHair(btn.dataset.style));
  });
  elements.applyColorBtn.addEventListener("click", applyColor);
  elements.colorPicker.addEventListener("input", () => {
    elements.colorSwatch.style.background = elements.colorPicker.value;
  });
  elements.resetBtn.addEventListener("click", resetGame);
}

function init() {
  wireEvents();
  resetGame();
}

init();
