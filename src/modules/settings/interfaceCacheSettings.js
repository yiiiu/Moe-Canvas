import { clearInterfaceCache, reloadAfterInterfaceCacheClear } from "../../services/interfaceCacheService.js";
import { showError, showSuccess } from "../../services/toastService.js";

function setButtonBusy(button, isBusy, label) {
  if (!button) return;
  button.disabled = Boolean(isBusy);
  if (label) button.textContent = label;
}

function createDialogButton(label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function confirmInterfaceCacheClear() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "preset-modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "preset-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "interfaceCacheConfirmTitle");
    dialog.setAttribute("aria-describedby", "interfaceCacheConfirmDesc");

    const icon = document.createElement("div");
    icon.className = "preset-modal-icon";
    icon.textContent = "!";

    const title = document.createElement("div");
    title.className = "preset-modal-title";
    title.id = "interfaceCacheConfirmTitle";
    title.textContent = "清理界面缓存？";

    const desc = document.createElement("div");
    desc.className = "preset-modal-desc";
    desc.id = "interfaceCacheConfirmDesc";
    desc.textContent = "将清理界面资源缓存并刷新页面，不会删除项目、用户设置、API Key 或授权信息。";

    const actions = document.createElement("div");
    actions.className = "preset-modal-actions";

    const confirmButton = createDialogButton("清理缓存并刷新", "preset-modal-btn-primary");
    const cancelButton = createDialogButton("取消", "preset-modal-btn-secondary");

    actions.append(confirmButton, cancelButton);
    dialog.append(icon, title, desc, actions);
    overlay.append(dialog);

    let settled = false;
    const close = (confirmed) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(confirmed);
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") close(false);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    cancelButton.addEventListener("click", () => close(false));
    confirmButton.addEventListener("click", () => close(true));
    document.addEventListener("keydown", handleKeydown);

    document.body.append(overlay);
    confirmButton.focus();
  });
}

export function initInterfaceCacheSettings() {
  const clearButton = document.getElementById("btnClearInterfaceCache");
  const statusText = document.getElementById("interfaceCacheStatusText");
  if (!clearButton) return;

  const defaultLabel = clearButton.textContent || "清理缓存并刷新";

  clearButton.addEventListener("click", async () => {
    const confirmed = await confirmInterfaceCacheClear();
    if (!confirmed) return;

    setButtonBusy(clearButton, true, "清理中...");
    if (statusText) {
      statusText.textContent = "正在清理界面资源缓存...";
      statusText.classList.remove("is-error");
    }

    try {
      const result = await clearInterfaceCache();
      if (statusText) statusText.textContent = "缓存已清理，正在刷新界面...";
      showSuccess("界面缓存已清理，正在刷新");
      setTimeout(() => reloadAfterInterfaceCacheClear(result), 400);
    } catch (error) {
      const message = error?.message || "清理界面缓存失败";
      if (statusText) {
        statusText.textContent = message;
        statusText.classList.add("is-error");
      }
      showError(message);
      setButtonBusy(clearButton, false, defaultLabel);
    }
  });
}