import { initTheme } from "./theme.js";
import { initUI } from "./ui.js";
import { initSync } from "./sync.js";
import { initBackup } from "./backup.js";
import { initNotifications } from "./notifications.js";

function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning, let's make today productive.";
  if (hour < 18) return "Good afternoon, keep the momentum going.";
  return "Good evening, let's wrap up the day well.";
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

function init() {
  initTheme();
  renderHeader();
  initUI();
  initSync();
  initBackup();
  initNotifications();

  // Keep the greeting and date correct if the app stays open across a time-of-day change
  setInterval(renderHeader, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderHeader();
  });
}

init();