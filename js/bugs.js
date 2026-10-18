import { initBugDialog } from "./bug-dialog.js";
import { initBugHome } from "./bugs-home.js";
import { initBugBoard } from "./bugs-board.js";

const HOME_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7M5 10v10h14V10"/></svg>';
const BOARD_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="6" rx="1.5"/></svg>';
const BUG_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="8" height="12" rx="4"/><path d="M12 8V5M9 5h6M3 12h5M16 12h5M4 18l4-2M20 18l-4-2M4 6l4 3M20 6l-4 3"/></svg>';

function loadStyles() {
  // The bug tracker brings its own stylesheet
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/bugs.css";
  document.head.appendChild(link);
}

// A "Bugs" group in the sidebar (desktop) and one "Bugs" button in the bottom navigation (phone)
function addNav() {
  document.querySelector('nav[aria-label="Workspace"]').insertAdjacentHTML(
    "afterend",
    `<nav class="nav-group" aria-label="Bugs">
      <p class="nav-label">Bugs</p>
      <button class="nav-item" type="button" data-view="bugs-home">${HOME_ICON}Home</button>
      <button class="nav-item" type="button" data-view="bugs-board">${BOARD_ICON}Board</button>
    </nav>`
  );

  document
    .querySelector(".bottom-nav")
    .insertAdjacentHTML("beforeend", `<button class="bn-item" type="button" data-view="bugs-home">${BUG_ICON}<span>Bugs</span></button>`);
}

// An empty screen inside the page, ready for a module to draw into
function makeView(id) {
  const el = document.createElement("div");
  el.className = "view";
  el.id = id;
  document.querySelector(".content").appendChild(el);
  return el;
}

export function initBugs() {
  loadStyles();
  addNav();
  initBugDialog();
  initBugHome(makeView("viewBugsHome"));
  initBugBoard(makeView("viewBugsBoard"));
}