import { initCalendar } from "./calendar.js";
import { initStats } from "./stats.js";
import { initFocus } from "./focus.js";

const CALENDAR_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const STATS_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';

function loadStyles() {
  // Calendar, Stats and Today's focus share one stylesheet
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/insights.css";
  document.head.appendChild(link);
}

// Calendar and Stats join the sidebar (desktop) and the bottom navigation (phone)
function addNav() {
  document
    .querySelector('nav[aria-label="Workspace"]')
    .insertAdjacentHTML(
      "beforeend",
      `<button class="nav-item" type="button" data-view="calendar">${CALENDAR_ICON}Calendar</button>` +
        `<button class="nav-item" type="button" data-view="stats">${STATS_ICON}Stats</button>`
    );

  document
    .querySelector(".bottom-nav")
    .insertAdjacentHTML(
      "beforeend",
      `<button class="bn-item" type="button" data-view="calendar">${CALENDAR_ICON}<span>Calendar</span></button>` +
        `<button class="bn-item" type="button" data-view="stats">${STATS_ICON}<span>Stats</span></button>`
    );
}

// An empty screen inside the page, ready for a module to draw into
function makeView(id) {
  const el = document.createElement("div");
  el.className = "view";
  el.id = id;
  document.querySelector(".content").appendChild(el);
  return el;
}

export function initInsights() {
  loadStyles();
  addNav();
  initFocus();
  initCalendar(makeView("viewCalendar"));
  initStats(makeView("viewStats"));
}