import { getBugs, commitBugs } from "./state.js";

export const STATUSES = ["todo", "progress", "testing", "solved"];
export const STATUS_LABEL = { todo: "To do", progress: "In progress", testing: "Testing", solved: "Solved" };
export const SEVERITIES = ["critical", "high", "medium", "low"];
export const SEVERITY_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_PERCENT = { todo: 0, progress: 40, testing: 80, solved: 100 }; // when a bug has no checklist
const MAX_LINKS = 10;
const MAX_STEPS = 50;

/* ---------- Reading ---------- */

export const getBug = (id) => getBugs().find((b) => b.id === id);

// How far along a bug is: from its checklist, or from its status if it has no checklist
export function bugProgress(bug) {
  const list = Array.isArray(bug.checklist) ? bug.checklist : [];
  const done = list.filter((i) => i.done).length;
  if (bug.status === "solved") return { done, total: list.length, percent: 100 };
  if (list.length) return { done, total: list.length, percent: Math.round((done / list.length) * 100) };
  return { done: 0, total: 0, percent: STATUS_PERCENT[bug.status] ?? 0 };
}

// Critical first, then the oldest
export const compareBugs = (a, b) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt.localeCompare(b.createdAt);

export function getProjects() {
  const names = new Set(getBugs().map((b) => b.project).filter(Boolean));
  return [...names].sort((a, b) => a.localeCompare(b));
}

/* ---------- Cleaning what the form sends ---------- */

function randomId(prefix) {
  const unique = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${unique}`;
}

// Lines or an array -> valid http(s) links ("figma.com/x" becomes "https://figma.com/x")
export function cleanLinks(value) {
  const lines = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    let text = String(line || "").trim();
    if (!text) continue;
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    try {
      const url = new URL(text);
      const host = url.hostname;
      const looksReal = host === "localhost" || host.includes(".");
      if (["http:", "https:"].includes(url.protocol) && looksReal && url.href.length <= 500 && !result.includes(url.href)) {
        result.push(url.href);
      }
    } catch {
      // not a link: ignored
    }
    if (result.length >= MAX_LINKS) break;
  }
  return result;
}

// Reuses an existing project name written with different capital letters
function resolveProject(name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!clean) return "";
  return getProjects().find((p) => p.toLowerCase() === clean.toLowerCase()) || clean;
}

function buildChecklist(rows) {
  const used = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      let id = r && r.id ? r.id : randomId("chk");
      if (used.has(id)) id = randomId("chk");
      used.add(id);
      return { id, title: String((r && r.title) || "").trim().slice(0, 200), done: Boolean(r && r.done) };
    })
    .filter((r) => r.title)
    .slice(0, MAX_STEPS);
}

function normalize(fields) {
  return {
    title: String(fields.title || "").trim().slice(0, 200),
    description: String(fields.description || "").trim().slice(0, 5000),
    steps: String(fields.steps || "").trim().slice(0, 5000),
    project: resolveProject(fields.project),
    status: STATUSES.includes(fields.status) ? fields.status : "todo",
    severity: SEVERITIES.includes(fields.severity) ? fields.severity : "medium",
    checklist: buildChecklist(fields.checklist),
    links: cleanLinks(fields.links),
  };
}

// The solved date: set when a bug becomes solved, cleared when it is reopened
function resolvedAtFor(bug, status, now) {
  if (status !== "solved") return "";
  return bug.status === "solved" && bug.resolvedAt ? bug.resolvedAt : now;
}

/* ---------- Changing ---------- */

export function addBug(fields) {
  const now = new Date().toISOString();
  const data = normalize(fields);
  const bug = {
    id: randomId("bug"),
    ...data,
    createdAt: now,
    updatedAt: now,
    resolvedAt: data.status === "solved" ? now : "",
  };
  commitBugs([...getBugs(), bug]);
  return bug.id;
}

export function updateBug(id, fields) {
  const now = new Date().toISOString();
  const data = normalize(fields);
  commitBugs(
    getBugs().map((b) =>
      b.id === id ? { ...b, ...data, updatedAt: now, resolvedAt: resolvedAtFor(b, data.status, now) } : b
    )
  );
}

export function moveBug(id, status) {
  if (!STATUSES.includes(status)) return;
  const now = new Date().toISOString();
  commitBugs(
    getBugs().map((b) =>
      b.id === id ? { ...b, status, updatedAt: now, resolvedAt: resolvedAtFor(b, status, now) } : b
    )
  );
}

export function deleteBug(id) {
  commitBugs(getBugs().filter((b) => b.id !== id));
}

// Undo: puts a bug back exactly as it was (re-inserts it if it was deleted)
export function restoreBug(snapshot, index) {
  const bugs = [...getBugs()];
  const i = bugs.findIndex((b) => b.id === snapshot.id);
  if (i >= 0) bugs[i] = snapshot;
  else bugs.splice(Math.min(index, bugs.length), 0, snapshot);
  commitBugs(bugs);
}

/* ---------- Display helpers shared by the bug screens ---------- */

export function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "today", "3d"
export function ageText(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days > 0 ? `${days}d` : "today";
}

export const severityBadge = (severity) =>
  `<span class="sev-badge sev-${severity}">${SEVERITY_LABEL[severity]}</span>`;

// 0-33 red, 34-66 amber, 67-99 blue, 100 green (same as task progress)
export function progressClass(percent) {
  if (percent >= 100) return "progress-done";
  if (percent >= 67) return "progress-high";
  if (percent >= 34) return "progress-mid";
  return "progress-low";
}

export function progressBar(percent) {
  return `
    <div class="progress-track" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
      <div class="progress-fill ${progressClass(percent)}" style="width:${percent}%"></div>
    </div>`;
}

// Title and the Home | Board switch at the top of both bug screens
export function bugHeader(active) {
  const cls = (name) => (active === name ? ' class="is-active"' : "");
  return `
    <div class="section-head bug-head">
      <h2>Bugs</h2>
      <div class="segmented" role="group" aria-label="Bug screens">
        <button type="button" data-view="bugs-home"${cls("home")}>Home</button>
        <button type="button" data-view="bugs-board"${cls("board")}>Board</button>
      </div>
    </div>`;
}