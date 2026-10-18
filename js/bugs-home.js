import { getBugs } from "./state.js";
import {
  STATUSES, STATUS_LABEL, SEVERITIES, SEVERITY_LABEL, bugProgress, compareBugs,
  esc, formatDate, ageText, severityBadge, progressBar, bugHeader,
} from "./bugs-core.js";
import { openBugDialog } from "./bug-dialog.js";
import { registerView } from "./ui.js";

const STATUS_COLOR = { todo: "#78909c", progress: "#4858a3", testing: "#d1964a", solved: "#3a9d6e" };
const SEVERITY_COLOR = { critical: "#d9363e", high: "#f4675e", medium: "#d1964a", low: "#78909c" };
const OPEN_LIST_LIMIT = 15;

let root = null;

const pad = (n) => String(n).padStart(2, "0");
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Horizontal bars: [{ label, value, color }]
function hbars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows
    .map(
      (r) => `
      <div class="hbar-row">
        <span class="hbar-label">${esc(r.label)}</span>
        <div class="hbar-track"><div class="hbar-fill" style="width:${r.value ? Math.max(4, Math.round((r.value / max) * 100)) : 0}%;background:${r.color}"></div></div>
        <span class="hbar-value">${r.value}</span>
      </div>`
    )
    .join("");
}

// Small column chart (same look as the Stats screen)
function columns(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `
    <div class="bars">
      ${items
        .map(
          (i) => `
        <div class="bar-col">
          <span class="bar-value">${i.value || ""}</span>
          <div class="bar-track"><div class="bar-fill${i.highlight ? " is-today" : ""}" style="height:${i.value ? Math.max(6, Math.round((i.value / max) * 100)) : 0}%"></div></div>
          <span class="bar-label">${esc(i.label)}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

function bugRow(bug) {
  const p = bugProgress(bug);
  const detail = [
    bug.project,
    p.total ? `${p.done}/${p.total} steps` : "",
    bug.status === "solved" ? `Solved ${formatDate(bug.resolvedAt || bug.updatedAt)}` : `${ageText(bug.createdAt)} open`,
  ]
    .filter(Boolean)
    .map(esc)
    .join(" · ");

  return `
    <button class="bug-row" type="button" data-bug="${esc(bug.id)}">
      <span class="bug-row-main">
        <span class="bug-row-title">${esc(bug.title)}</span>
        <span class="bug-row-meta">${detail}</span>
      </span>
      ${severityBadge(bug.severity)}
      <span class="bug-row-progress">${progressBar(p.percent)}<span class="progress-label">${p.percent}%</span></span>
    </button>`;
}

function render() {
  if (!root) return;
  const bugs = getBugs();

  if (!bugs.length) {
    root.innerHTML = `
      ${bugHeader("home")}
      <div class="card">
        <div class="empty">
          <p class="empty-title">No bugs yet</p>
          <p class="muted">Track the bugs you find while developing: severity, steps, and how far each fix is.</p>
          <button class="btn btn-primary btn-sm bug-empty-btn" type="button" data-new>Add your first bug</button>
        </div>
      </div>`;
    return;
  }

  const solved = bugs.filter((b) => b.status === "solved");
  const open = bugs.filter((b) => b.status !== "solved").sort(compareBugs);
  const percents = bugs.map((b) => bugProgress(b).percent);
  const overall = Math.round(percents.reduce((a, b) => a + b, 0) / bugs.length);
  const solvedShare = Math.round((solved.length / bugs.length) * 100);

  const statusRows = STATUSES.map((s) => ({
    label: STATUS_LABEL[s],
    value: bugs.filter((b) => b.status === s).length,
    color: STATUS_COLOR[s],
  }));
  const severityRows = SEVERITIES.map((s) => ({
    label: SEVERITY_LABEL[s],
    value: open.filter((b) => b.severity === s).length,
    color: SEVERITY_COLOR[s],
  }));

  // By project
  const projects = new Map();
  bugs.forEach((b) => {
    const name = b.project || "No project";
    if (!projects.has(name)) projects.set(name, []);
    projects.get(name).push(b);
  });
  const projectRows = [...projects.entries()]
    .map(([name, list]) => ({
      name,
      total: list.length,
      solved: list.filter((b) => b.status === "solved").length,
      percent: Math.round(list.reduce((sum, b) => sum + bugProgress(b).percent, 0) / list.length),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Solved in the last 7 days
  const solvedByDay = new Map();
  solved.forEach((b) => {
    const d = new Date(b.resolvedAt || b.updatedAt);
    if (!Number.isNaN(d.getTime())) solvedByDay.set(toStr(d), (solvedByDay.get(toStr(d)) || 0) + 1);
  });
  const today = new Date();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i - 6);
    return {
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      value: solvedByDay.get(toStr(d)) || 0,
      highlight: i === 6,
    };
  });

  const recent = [...solved]
    .sort((a, b) => (b.resolvedAt || b.updatedAt).localeCompare(a.resolvedAt || a.updatedAt))
    .slice(0, 5);

  root.innerHTML = `
    ${bugHeader("home")}

    <section class="stats" aria-label="Bug summary">
      <article class="card stat"><p class="stat-label">Open</p><p class="stat-value">${open.length}</p></article>
      <article class="card stat"><p class="stat-label">Solved</p><p class="stat-value">${solved.length}</p></article>
      <article class="card stat"><p class="stat-label">Total</p><p class="stat-value">${bugs.length}</p></article>
      <article class="card stat"><p class="stat-label">Solved</p><p class="stat-value">${solvedShare}<span class="stat-unit">%</span></p></article>
    </section>

    <section class="section">
      <div class="section-head"><h2>Overall progress</h2><button class="btn btn-primary btn-sm" type="button" data-new>New bug</button></div>
      <div class="card bug-overall">
        ${progressBar(overall)}
        <span class="progress-label">${overall}%</span>
      </div>
    </section>

    <div class="bug-grid">
      <section class="section">
        <div class="section-head"><h2>By status</h2></div>
        <div class="card bug-hbars">${hbars(statusRows)}</div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Open by severity</h2></div>
        <div class="card bug-hbars">${hbars(severityRows)}</div>
      </section>
    </div>

    <section class="section">
      <div class="section-head"><h2>Open bugs</h2><span class="muted">${open.length}</span></div>
      <div class="card">
        ${
          open.length
            ? open.slice(0, OPEN_LIST_LIMIT).map(bugRow).join("") +
              (open.length > OPEN_LIST_LIMIT ? `<p class="muted bug-more">…and ${open.length - OPEN_LIST_LIMIT} more on the Board</p>` : "")
            : '<div class="empty"><p class="empty-title">No open bugs</p><p class="muted">Everything is solved.</p></div>'
        }
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>By project</h2></div>
      <div class="card">
        ${projectRows
          .map(
            (r) => `
          <div class="project-row">
            <span class="project-name">${esc(r.name)}</span>
            <span class="project-meta">${r.solved}/${r.total} solved</span>
            <span class="bug-row-progress">${progressBar(r.percent)}<span class="progress-label">${r.percent}%</span></span>
          </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Solved in the last 7 days</h2></div>
      <div class="card">${columns(week)}</div>
    </section>

    ${
      recent.length
        ? `<section class="section">
      <div class="section-head"><h2>Recently solved</h2></div>
      <div class="card">${recent.map(bugRow).join("")}</div>
    </section>`
        : ""
    }`;
}

export function initBugHome(element) {
  root = element;
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) {
      openBugDialog();
      return;
    }
    const row = e.target.closest("[data-bug]");
    if (row) openBugDialog({ id: row.dataset.bug });
  });
  registerView("bugs-home", root, render);
}