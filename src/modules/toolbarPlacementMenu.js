const STORAGE_KEY = "moe.toolbarPlacement";
const PLACEMENTS = new Set(["side", "bottom"]);

function normalizePlacement(value) {
	return PLACEMENTS.has(value) ? value : "side";
}

function readPlacement() {
	try {
		return normalizePlacement(window.localStorage?.getItem(STORAGE_KEY));
	} catch (_) {
		return "side";
	}
}

function savePlacement(placement) {
	try {
		window.localStorage?.setItem(STORAGE_KEY, placement);
	} catch (_) {
		// 忽略不可用的本地存储，仍保持本次运行态生效。
	}
}

function applyPlacement(placement) {
	const nextPlacement = normalizePlacement(placement);
	document.body.dataset.toolbarPlacement = nextPlacement;
	window.dispatchEvent(
		new CustomEvent("moe-toolbar-placement-change", {
			detail: { placement: nextPlacement },
		}),
	);
	return nextPlacement;
}

function createMenu() {
	const menu = document.createElement("div");
	menu.className = "toolbar-placement-menu";
	menu.setAttribute("role", "menu");
	menu.setAttribute("aria-hidden", "true");
	menu.innerHTML = `
		<button type="button" class="toolbar-placement-menu-item" data-toolbar-placement-option="side" role="menuitemradio" aria-checked="false">
			<span class="toolbar-placement-menu-check">✓</span>
			<span>侧边显示</span>
		</button>
		<button type="button" class="toolbar-placement-menu-item" data-toolbar-placement-option="bottom" role="menuitemradio" aria-checked="false">
			<span class="toolbar-placement-menu-check">✓</span>
			<span>底部显示</span>
		</button>
	`;
	document.body.appendChild(menu);
	return menu;
}

function positionMenu(menu, anchor) {
	const rect = anchor.getBoundingClientRect();
	const left = Math.max(12, Math.min(rect.left, window.innerWidth - 154));
	menu.style.left = `${left}px`;
	menu.style.top = `${rect.bottom + 6}px`;
}

function syncMenu(menu, placement) {
	menu.querySelectorAll("[data-toolbar-placement-option]").forEach((item) => {
		const active = item.dataset.toolbarPlacementOption === placement;
		item.classList.toggle("active", active);
		item.setAttribute("aria-checked", String(active));
	});
}

export function initToolbarPlacementMenu() {
	const logo = document.getElementById("logoLink");
	const sidebar = document.querySelector(".sidebar-floating");
	if (!logo || !sidebar) return;

	const menu = createMenu();
	let currentPlacement = applyPlacement(readPlacement());
	syncMenu(menu, currentPlacement);

	const closeMenu = () => {
		menu.classList.remove("open");
		menu.setAttribute("aria-hidden", "true");
		logo.setAttribute("aria-expanded", "false");
	};

	const openMenu = () => {
		positionMenu(menu, logo);
		syncMenu(menu, currentPlacement);
		menu.classList.add("open");
		menu.setAttribute("aria-hidden", "false");
		logo.setAttribute("aria-expanded", "true");
	};

	const toggleMenu = () => {
		if (menu.classList.contains("open")) {
			closeMenu();
			return;
		}
		openMenu();
	};

	logo.setAttribute("role", "button");
	logo.setAttribute("tabindex", "0");
	logo.setAttribute("aria-haspopup", "menu");
	logo.setAttribute("aria-expanded", "false");

	logo.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		toggleMenu();
	});

	logo.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		toggleMenu();
	});

	menu.addEventListener("click", (event) => {
		const item = event.target.closest("[data-toolbar-placement-option]");
		if (!item) return;
		currentPlacement = applyPlacement(item.dataset.toolbarPlacementOption);
		savePlacement(currentPlacement);
		syncMenu(menu, currentPlacement);
		closeMenu();
	});

	document.addEventListener("pointerdown", (event) => {
		if (!menu.classList.contains("open")) return;
		if (menu.contains(event.target) || logo.contains(event.target)) return;
		closeMenu();
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeMenu();
	});

	window.addEventListener("resize", () => {
		if (menu.classList.contains("open")) positionMenu(menu, logo);
	});
}