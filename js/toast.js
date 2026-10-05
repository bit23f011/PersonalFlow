let toastEl = null;
let timer = null;

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  return toastEl;
}

export function hideToast() {
  clearTimeout(timer);
  if (toastEl) toastEl.hidden = true;
}

// Shows a short message with an optional action button (e.g. Undo). One toast at a time.
export function showToast(message, { actionLabel = "", onAction = null, duration = 6000 } = {}) {
  const el = ensureToast();
  clearTimeout(timer);
  el.textContent = "";

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.appendChild(text);

  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      hideToast();
      onAction();
    });
    el.appendChild(btn);
  }

  el.hidden = false;
  timer = setTimeout(hideToast, duration);
}