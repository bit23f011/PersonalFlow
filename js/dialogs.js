const $ = (id) => document.getElementById(id);

// Shows the confirm dialog. Resolves true if the user confirms, false otherwise (Cancel / Esc).
export function confirmAction({ title, text, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dialog = $("confirmDialog");
    const okBtn = $("confirmOkBtn");
    const cancelBtn = $("confirmCancelBtn");

    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    okBtn.textContent = confirmLabel;
    okBtn.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;

    let result = false;
    const onOk = () => {
      result = true;
      dialog.close();
    };
    const onCancel = () => dialog.close();

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener(
      "close",
      () => {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      },
      { once: true }
    );

    dialog.showModal();
  });
}