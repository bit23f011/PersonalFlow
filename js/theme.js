const STORAGE_KEY = "personalflow-theme";
const ORDER = ["light", "dark", "system"];
const LABELS = { light: "Light", dark: "Dark", system: "System" };

const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePreference() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return ORDER.includes(saved) ? saved : "system";
}

function applyTheme(pref) {
  const isDark = pref === "dark" || (pref === "system" && systemQuery.matches);
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");

  document.querySelectorAll(".js-theme-label").forEach((el) => {
    el.textContent = `Theme: ${LABELS[pref]}`;
  });
  document.querySelectorAll(".js-theme-toggle").forEach((el) => {
    el.setAttribute("aria-label", `Theme: ${LABELS[pref]}. Click to change.`);
    el.title = `Theme: ${LABELS[pref]}`;
  });
  // Settings page buttons
  document.querySelectorAll("[data-theme-choice]").forEach((el) => {
    const on = el.dataset.themeChoice === pref;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-pressed", String(on));
  });
}

export function setThemePreference(pref) {
  localStorage.setItem(STORAGE_KEY, pref);
  applyTheme(pref);
}

export function initTheme() {
  applyTheme(getThemePreference());

  // Cycle light -> dark -> system on click
  document.querySelectorAll(".js-theme-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = ORDER[(ORDER.indexOf(getThemePreference()) + 1) % ORDER.length];
      setThemePreference(next);
    });
  });

  // Direct choice from the Settings page
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => setThemePreference(btn.dataset.themeChoice));
  });

  // React to OS theme changes while in "system" mode
  systemQuery.addEventListener("change", () => {
    if (getThemePreference() === "system") applyTheme("system");
  });
}