const ASSISTANT_FAB_STATES = {
	hello: {
		src: "images/assistant/1-waving hello.png",
		label: "欢迎",
	},
	happy: {
		src: "images/assistant/2-happily jumping.png",
		label: "推荐",
	},
	thinking: {
		src: "images/assistant/3-Thinking.png",
		label: "思考中",
	},
	creating: {
		src: "images/assistant/4-Typing creating.png",
		label: "创建中",
	},
	cheering: {
		src: "images/assistant/5-Cheering.png",
		label: "已完成",
	},
	sleepy: {
		src: "images/assistant/6-Sleepy  yawning.png",
		label: "空闲中",
	},
	surprised: {
		src: "images/assistant/7-Surprised shocked.png",
		label: "需要注意",
	},
	guide: {
		src: "images/assistant/8-Presenting guiding.png",
		label: "Moe 助手",
	},
};

const DEFAULT_STATE = "guide";
const INTRO_STATE_MS = 3600;
const TRANSIENT_STATE_MS = 2600;
const IDLE_STATE_MS = 90000;
const MIN_CREATING_VISIBLE_MS = 650;

function preloadAssistantFabImages() {
	Object.values(ASSISTANT_FAB_STATES).forEach(({ src }) => {
		const img = new Image();
		img.src = src;
	});
}

function initAssistantFabStateManager() {
	const button = document.getElementById("fabBtn");
	const image = document.getElementById("assistantFabImg");
	if (!button || !image) return;

	let currentState = button.dataset.assistantState || DEFAULT_STATE;
	let resetTimer = null;
	let idleTimer = null;

	const setState = (state, options = {}) => {
		const nextState = ASSISTANT_FAB_STATES[state] ? state : DEFAULT_STATE;
		const config = ASSISTANT_FAB_STATES[nextState];
		const shouldReturnToGuide = options.returnToGuide !== false && nextState !== DEFAULT_STATE;
		const duration = Number.isFinite(options.duration) ? options.duration : TRANSIENT_STATE_MS;

		clearTimeout(resetTimer);
		if (nextState === currentState && image.getAttribute("src") === config.src) {
			if (shouldReturnToGuide) {
				resetTimer = setTimeout(() => setState(DEFAULT_STATE, { returnToGuide: false }), duration);
			}
			return;
		}

		currentState = nextState;
		button.classList.add("is-switching");
		window.setTimeout(() => {
			image.src = config.src;
			image.alt = `Moe 助手：${config.label}`;
			button.dataset.assistantState = nextState;
			button.title = config.label === "Moe 助手" ? "Moe 助手" : `Moe 助手 · ${config.label}`;
			button.classList.remove("is-switching");
		}, 110);

		if (shouldReturnToGuide) {
			resetTimer = setTimeout(() => setState(DEFAULT_STATE, { returnToGuide: false }), duration);
		}
	};

	const resetIdleTimer = () => {
		clearTimeout(idleTimer);
		if (currentState === "sleepy") {
			setState(DEFAULT_STATE, { returnToGuide: false });
		}
		idleTimer = setTimeout(() => {
			if (currentState === DEFAULT_STATE) {
				setState("sleepy", { returnToGuide: false });
			}
		}, IDLE_STATE_MS);
	};

	const markCreating = () => {
		creatingVisibleSince = performance.now();
		clearTimeout(pendingCheeringTimer);
		pendingCheeringTimer = null;
		setState("creating", { returnToGuide: false });
	};
	const markCheering = () => setState("cheering", { duration: 2600 });
	const markSurprised = () => setState("surprised", { duration: 4200 });
	let pendingNodeCreation = null;
	let nodeCreationObserver = null;
	let nodeCreationCancelTimer = null;
	let creatingVisibleSince = 0;
	let pendingCheeringTimer = null;

	const getCanvasNodes = () => Array.from(document.getElementById("v2-canvas")?.querySelectorAll(".v2-node") || []);
	const getNodeIdentity = (node) => node?.dataset?.nodeId || node?.dataset?.id || node?.id || null;
	const getNodeCreationSnapshot = () => {
		const nodes = getCanvasNodes();
		return {
			elements: new Set(nodes),
			identities: new Set(nodes.map(getNodeIdentity).filter(Boolean)),
		};
	};
	const clearPendingNodeCreation = () => {
		pendingNodeCreation = null;
		clearTimeout(nodeCreationCancelTimer);
		nodeCreationCancelTimer = null;
	};
	const scheduleCheeringAfterCreating = () => {
		const elapsed = performance.now() - creatingVisibleSince;
		const delay = Math.max(0, MIN_CREATING_VISIBLE_MS - elapsed);
		clearTimeout(pendingCheeringTimer);
		pendingCheeringTimer = window.setTimeout(() => {
			pendingCheeringTimer = null;
			markCheering();
		}, delay);
	};
	const completePendingNodeCreation = () => {
		if (!pendingNodeCreation) return false;
		const shouldDelayForCreating = pendingNodeCreation.showCreating === true;
		const hasNewNode = getCanvasNodes().some((node) => {
			const identity = getNodeIdentity(node);
			if (identity) return !pendingNodeCreation.identities.has(identity);
			return !pendingNodeCreation.elements.has(node);
		});
		if (!hasNewNode) return false;
		clearPendingNodeCreation();
		if (shouldDelayForCreating) {
			scheduleCheeringAfterCreating();
		} else {
			markCheering();
		}
		return true;
	};
	const cancelPendingNodeCreation = () => {
		if (!pendingNodeCreation || completePendingNodeCreation()) return;
		clearPendingNodeCreation();
		setState(DEFAULT_STATE, { returnToGuide: false });
	};
	const observeNodeCreation = () => {
		if (nodeCreationObserver) return;
		const canvas = document.getElementById("v2-canvas");
		if (!canvas) return;
		nodeCreationObserver = new MutationObserver(completePendingNodeCreation);
		nodeCreationObserver.observe(canvas, { childList: true, subtree: true });
	};
	const watchNodeCreationCompletion = (snapshot, { showCreating = false } = {}) => {
		pendingNodeCreation = { ...snapshot, showCreating };
		if (showCreating) {
			markCreating();
		}
		observeNodeCreation();
		clearTimeout(nodeCreationCancelTimer);
		nodeCreationCancelTimer = window.setTimeout(cancelPendingNodeCreation, 12000);
		window.setTimeout(completePendingNodeCreation, 0);
	};
	const markNodeCreationStarted = () => {
		watchNodeCreationCompletion(getNodeCreationSnapshot());
	};
	const markResourceCreationStarted = () => {
		watchNodeCreationCompletion(getNodeCreationSnapshot(), { showCreating: true });
	};
	const getNodeCreationMenuRow = (target) => target?.closest(".v2-node-picker .v2-menu-row") || null;
	const isResourceMenuRow = (row) => {
		if (!row) return false;
		if (row.dataset?.type === "resource") return true;
		const label = row.textContent || "";
		return label.includes("上传") || label.includes("文件");
	};
	const isNodeCreationMenuTarget = (target, selector) => {
		const item = target?.closest(selector);
		return Boolean(item?.dataset?.type && item.dataset.type !== "resource");
	};

	preloadAssistantFabImages();
	setState("hello", { duration: INTRO_STATE_MS });
	resetIdleTimer();

	button.addEventListener("mouseenter", () => setState("happy", { duration: 1600 }));
	button.addEventListener("click", () => setState("guide", { returnToGuide: false }));

	document.getElementById("btnAdd")?.addEventListener("mouseenter", () => setState("happy", { duration: 1800 }));
	document.getElementById("emptyHint")?.addEventListener(
		"click",
		(event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (isNodeCreationMenuTarget(target, ".pill-btn[data-type]")) {
				markNodeCreationStarted();
			}
		},
		true,
	);
	document.addEventListener(
		"click",
		(event) => {
			const target = event.target instanceof Element ? event.target : null;
			const menuRow = getNodeCreationMenuRow(target);
			if (!menuRow) return;
			if (isResourceMenuRow(menuRow)) {
				markResourceCreationStarted();
				return;
			}
			markNodeCreationStarted();
		},
		true,
	);

	["pointerdown", "keydown", "wheel", "drop"].forEach((eventName) => {
		window.addEventListener(eventName, resetIdleTimer, { passive: true });
	});
	window.addEventListener("error", markSurprised);
	window.addEventListener("unhandledrejection", markSurprised);
	window.addEventListener("moe-assistant-state", (event) => {
		setState(event.detail?.state, {
			duration: event.detail?.duration,
			returnToGuide: event.detail?.returnToGuide,
		});
	});

	window.MoeAssistantFab = {
		setState,
		states: Object.freeze({ ...ASSISTANT_FAB_STATES }),
	};
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initAssistantFabStateManager, { once: true });
} else {
	initAssistantFabStateManager();
}