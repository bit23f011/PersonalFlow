import { initTheme } from "./theme.js";
import { initLock } from "./lock.js";
import { initUI } from "./ui.js";
import { initBulk } from "./bulk.js";
import { initQuickAdd } from "./quickadd.js";
import { initPomodoro } from "./pomodoro.js";
import { initAlerts } from "./alerts.js";
import { initSync } from "./sync.js";
import { initBackup } from "./backup.js";
import { initNotifications } from "./notifications.js";

const SPLASH_KEY = "personalflow-splash";
const SPLASH_MIN_MS = 1000; // the splash stays visible at least this long after the page starts loading

function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good Morning Mujahid, let's make today productive.";
  if (hour < 18) return "Good Afternoon Mujahid, keep the momentum going.";
  return "Good Evening Mujahid, let's wrap up the day well.";
}

function renderHeader() {
  const now = new Date();
  document.getElementById("greeting").textContent = getGreeting(now);
  document.getElementById("currentDate").textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Fades the splash out (once per session) after the app is ready
function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;

  if (document.documentElement.classList.contains("no-splash")) {
    splash.remove(); // already shown in this session
    return;
  }

  const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
  setTimeout(() => {
    splash.classList.add("is-hiding");
    setTimeout(() => splash.remove(), 400);
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // private mode: the splash will simply show again next time
    }
  }, wait);
}

function init() {
  initTheme();
  initLock(); // right after the theme, so the lock screen covers the app as early as possible
  renderHeader();
  initUI();
  initBulk(); // after initUI: it re-applies the selection after every list redraw
  initQuickAdd();
  initPomodoro();
  initAlerts();
  initSync();
  initBackup();
  initNotifications();

  // Keep the greeting and date correct if the app stays open across a time-of-day change
  setInterval(renderHeader, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderHeader();
  });

  hideSplash();
}

init();