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
				setState("sleepy", { duration: 5200 });
			}
		}, IDLE_STATE_MS);
	};

	const markCreating = () => setState("creating", { duration: 1800 });
	const markCheering = () => setState("cheering", { duration: 2600 });

	preloadAssistantFabImages();
	setState("hello", { duration: INTRO_STATE_MS });
	resetIdleTimer();

	button.addEventListener("mouseenter", () => setState("happy", { duration: 1600 }));
	button.addEventListener("click", () => setState("guide", { returnToGuide: false }));

	document.getElementById("btnAdd")?.addEventListener("click", () => setState("happy", { duration: 1800 }));
	document.getElementById("btnAddCanvas")?.addEventListener("click", markCheering);
	document.getElementById("emptyHint")?.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".pill-btn")) {
			markCreating();
			window.setTimeout(markCheering, 900);
		}
	});
	document.getElementById("nodeMenu")?.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".nam-item, .nam-upload")) {
			markCreating();
			window.setTimeout(markCheering, 900);
		}
	});

	["pointerdown", "keydown", "wheel", "drop"].forEach((eventName) => {
		window.addEventListener(eventName, resetIdleTimer, { passive: true });
	});
	window.addEventListener("error", () => setState("surprised", { duration: 4200 }));
	window.addEventListener("unhandledrejection", () => setState("surprised", { duration: 4200 }));
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