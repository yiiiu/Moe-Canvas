import { GenerationHistoryFileManager } from "./GenerationHistoryFileManager.js";

const POPUP_ID = "generationHistoryPopupOverlay";

let popupState = {
	overlay: null,
	content: null,
	manager: null,
};

const makeEl = (tag, className = "", text = "") => {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text) el.textContent = text;
	return el;
};

const closeGenerationHistoryPopup = () => {
	popupState.manager?.hide?.();
	popupState.overlay?.classList.remove("open");
};

const ensureManager = () => {
	if (popupState.manager || !popupState.content) return popupState.manager;
	popupState.manager = new GenerationHistoryFileManager({
		mountEl: popupState.content,
		bindSidebar: false,
		bindGenerationEvents: false,
		multiSelectOnClick: true,
		bindDoubleClickToCanvas: false,
	});
	popupState.manager.panel?.classList.add("generation-history-popup-file-panel");
	return popupState.manager;
};

const ensurePopup = () => {
	if (popupState.overlay?.isConnected) return popupState.overlay;
	const overlay = makeEl("div", "generation-history-popup-overlay");
	overlay.id = POPUP_ID;
	overlay.setAttribute("role", "dialog");
	overlay.setAttribute("aria-modal", "true");
	overlay.setAttribute("aria-label", "历史记录");

	const panel = makeEl("div", "generation-history-popup-panel");
	const header = makeEl("div", "generation-history-popup-header");
	const titleWrap = makeEl("div", "generation-history-popup-title-wrap");
	titleWrap.appendChild(makeEl("div", "generation-history-popup-title", "历史记录"));
	titleWrap.appendChild(makeEl("div", "generation-history-popup-subtitle", "浏览并管理当前项目中的生成媒体"));
	const closeBtn = makeEl("button", "generation-history-popup-close", "×");
	closeBtn.type = "button";
	closeBtn.setAttribute("aria-label", "关闭历史记录");
	header.appendChild(titleWrap);
	header.appendChild(closeBtn);
	const content = makeEl("div", "generation-history-popup-content");
	panel.appendChild(header);
	panel.appendChild(content);
	overlay.appendChild(panel);
	document.body.appendChild(overlay);

	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) closeGenerationHistoryPopup();
	});
	closeBtn.addEventListener("click", closeGenerationHistoryPopup);
	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && overlay.classList.contains("open")) closeGenerationHistoryPopup();
	});

	popupState.overlay = overlay;
	popupState.content = content;
	ensureManager();
	return overlay;
};

export function openGenerationHistoryPopup() {
	const overlay = ensurePopup();
	overlay.classList.add("open");
	if (popupState.manager) popupState.manager._recordsDirty = true;
	popupState.manager?.show?.();
}
