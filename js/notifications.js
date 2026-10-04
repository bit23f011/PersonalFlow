import { getTasks } from "./state.js";
import { getTodayTasks, todayStr, tomorrowStr } from "./tasks.js";

const KEY = "personalflow-notify"; // per device (permission is per device too)
const DEFAULTS = { enabled: false, time: "09:00", lastDate: "" };
const supported = "Notification" in window;

const $ = (id) => document.getElementById(id);

/* ---------- Saved settings ---------- */

function loadSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("Could not save reminder settings", err);
  }
}

function timePassed(time) {
  const [h, m] = time.split(":").map(Number);
  const now = new Date();
  return now >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
}

// If today's reminder time already passed, the first reminder is tomorrow
function armToday(settings) {
  settings.lastDate = timePassed(settings.time) ? todayStr() : "";
}

/* ---------- Showing notifications ---------- */

async function getRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
}

async function showNotification(title, body, tag) {
  const options = {
    body,
    tag,
    icon: new URL("assets/avatar.png", location.href).href,
  };
  try {
    const reg = await getRegistration();
    if (reg) await reg.showNotification(title, options); // required on Android
    else new Notification(title, options);
    return true;
  } catch (err) {
    console.error("Notification failed", err);
    return false;
  }
}

function buildSummary() {
  const today = todayStr();
  const dueNow = getTodayTasks().filter((t) => !t.completed); // today + overdue
  const tomorrow = getTasks().filter((t) => !t.completed && t.dueDate === tomorrowStr()).length;
  if (!dueNow.length && !tomorrow) return null;

  const overdue = dueNow.filter((t) => t.dueDate < today).length;
  const lines = [];
  if (dueNow.length) {
    const names = dueNow.slice(0, 3).map((t) => t.title).join(" • ");
    lines.push(names + (dueNow.length > 3 ? ` +${dueNow.length - 3} more` : ""));
  }
  if (tomorrow) lines.push(`Tomorrow: ${tomorrow} task${tomorrow === 1 ? "" : "s"}`);

  const title = dueNow.length
    ? `${dueNow.length} task${dueNow.length === 1 ? "" : "s"} for today${overdue ? ` (${overdue} overdue)` : ""}`
    : "Nothing due today";
  return { title, body: lines.join("\n") };
}

/* ---------- Daily reminder check ---------- */

function checkReminder() {
  if (!supported || Notification.permission !== "granted") return;
  const settings = loadSettings();
  if (!settings.enabled) return;

  const today = todayStr();
  if (settings.lastDate === today) return; // already reminded today
  if (!timePassed(settings.time)) return; // not yet time

  settings.lastDate = today;
  saveSettings(settings);

  const summary = buildSummary();
  if (summary) showNotification(summary.title, summary.body, "personalflow-daily");
}

/* ---------- Settings UI ---------- */

function renderUI() {
  const settings = loadSettings();
  $("notifyTime").value = settings.time;

  if (!supported) {
    ["notifyTime", "notifyToggleBtn", "notifyTestBtn"].forEach((id) => {
      $(id).disabled = true;
    });
    $("notifyMessage").textContent = "This browser doesn't support notifications.";
    return;
  }

  const on = settings.enabled && Notification.permission === "granted";
  $("notifyToggleBtn").textContent = on ? "Turn off" : "Turn on";

  if (Notification.permission === "denied") {
    $("notifyMessage").textContent =
      "Notifications are blocked for this site. Allow them in your browser's site settings, then turn reminders on.";
  } else {
    $("notifyMessage").textContent = on ? `Daily reminder is set for ${settings.time}.` : "Reminders are off.";
  }
}

async function toggleReminders() {
  const settings = loadSettings();
  const on = settings.enabled && Notification.permission === "granted";

  if (on) {
    settings.enabled = false;
    saveSettings(settings);
    renderUI();
    return;
  }

  const permission =
    Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;

  if (permission === "granted") {
    settings.enabled = true;
    armToday(settings);
  } else {
    settings.enabled = false;
  }
  saveSettings(settings);
  renderUI();
  checkReminder();
}

async function sendTest() {
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") {
    renderUI();
    return;
  }

  const summary = buildSummary();
  const ok = await showNotification(
    summary ? summary.title : "PersonalFlow",
    summary ? summary.body : "Notifications are working.",
    "personalflow-test"
  );
  $("notifyMessage").textContent = ok
    ? "Test notification sent. Check your notification panel."
    : "Couldn't show the notification. Check your browser's notification settings.";
}

function onTimeChange(e) {
  const value = e.target.value;
  if (!/^\d{2}:\d{2}$/.test(value)) {
    renderUI();
    return;
  }
  const settings = loadSettings();
  settings.time = value;
  armToday(settings);
  saveSettings(settings);
  renderUI();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (err) {
    console.error("Service worker registration failed", err);
  }
}

export function initNotifications() {
  registerServiceWorker();

  $("notifyToggleBtn").addEventListener("click", toggleReminders);
  $("notifyTestBtn").addEventListener("click", sendTest);
  $("notifyTime").addEventListener("change", onTimeChange);
  renderUI();

  if (!supported) return;
  checkReminder();
  setInterval(checkReminder, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkReminder();
      renderUI();
    }
  });
}