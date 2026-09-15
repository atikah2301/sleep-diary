import { signIn, signOut, getSession, onAuthStateChange } from "./auth.js";
import { initEntryView } from "./entry.js";
import { initDashboardView } from "./dashboard.js";
import { initTableView } from "./table.js";
import { initExportView } from "./export.js";
import { initGoalsView } from "./goals.js";

const viewLogin = document.querySelector("#view-login");
const viewMain = document.querySelector("#view-main");
const loginForm = document.querySelector("#login-form");
const loginPassword = document.querySelector("#login-password");
const loginError = document.querySelector("#login-error");
const logoutButton = document.querySelector("#logout-button");
const tabButtons = document.querySelectorAll("nav.tabs button[data-tab]");

const panels = {
  entry: document.querySelector("#tab-entry"),
  trends: document.querySelector("#tab-trends"),
  table: document.querySelector("#tab-table"),
  export: document.querySelector("#tab-export"),
  goals: document.querySelector("#tab-goals"),
};

const initializers = {
  entry: initEntryView,
  trends: initDashboardView,
  table: initTableView,
  export: initExportView,
  goals: initGoalsView,
};

const initialized = { entry: false, trends: false, table: false, export: false, goals: false };

function showTab(tabName) {
  for (const [name, panel] of Object.entries(panels)) {
    panel.hidden = name !== tabName;
  }
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
  if (!initialized[tabName]) {
    initialized[tabName] = true;
    initializers[tabName](panels[tabName]);
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});

function showLoggedIn() {
  viewLogin.hidden = true;
  viewMain.hidden = false;
  if (!initialized.entry) {
    initialized.entry = true;
    initializers.entry(panels.entry);
  }
}

function showLoggedOut() {
  viewMain.hidden = true;
  viewLogin.hidden = false;
  loginPassword.value = "";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  try {
    await signIn(loginPassword.value);
  } catch (err) {
    loginError.textContent = "Incorrect password.";
    loginError.hidden = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut();
});

onAuthStateChange((session) => {
  if (session) {
    showLoggedIn();
  } else {
    showLoggedOut();
  }
});

const session = await getSession();
if (session) {
  showLoggedIn();
} else {
  showLoggedOut();
}
