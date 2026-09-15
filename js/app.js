import { signInWithPasscode, signOut, getSession, onAuthStateChange } from "./auth.js";
import { initEntryView } from "./entry.js";
import { initDashboardView } from "./dashboard.js";
import { initTableView } from "./table.js";
import { initExportView } from "./export.js";

const viewLogin = document.querySelector("#view-login");
const viewMain = document.querySelector("#view-main");
const loginForm = document.querySelector("#login-form");
const loginPasscode = document.querySelector("#login-passcode");
const loginError = document.querySelector("#login-error");
const logoutButton = document.querySelector("#logout-button");
const tabButtons = document.querySelectorAll("nav.tabs button[data-tab]");

const panels = {
  entry: document.querySelector("#tab-entry"),
  trends: document.querySelector("#tab-trends"),
  table: document.querySelector("#tab-table"),
  export: document.querySelector("#tab-export"),
};

const initializers = {
  entry: initEntryView,
  trends: initDashboardView,
  table: initTableView,
  export: initExportView,
};

const initialized = { entry: false, trends: false, table: false, export: false };

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
  loginPasscode.value = "";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  try {
    await signInWithPasscode(loginPasscode.value);
  } catch (err) {
    loginError.textContent = "Incorrect passcode.";
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
