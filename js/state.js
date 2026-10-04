import { loadData, saveData } from "./storage.js";

const data = loadData();
const listeners = new Set();

function persistAndNotify() {
  if (!saveData(data)) {
    alert("Couldn't save your changes on this device. Browser storage may be full or blocked.");
  }
  listeners.forEach((fn) => fn());
}

export function getData() {
  return data;
}

export function getTasks() {
  return data.tasks;
}

// Local edit: bumps the document timestamp
export function commitTasks(tasks) {
  data.tasks = tasks;
  data.updatedAt = new Date().toISOString();
  persistAndNotify();
}

// Used when loading data from the cloud: keeps the cloud timestamp as-is
export function replaceData(next) {
  data.version = next.version;
  data.updatedAt = next.updatedAt;
  data.tasks = next.tasks;
  data.settings = next.settings || {};
  persistAndNotify();
}

export function subscribe(fn) {
  listeners.add(fn);
}