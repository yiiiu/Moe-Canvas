const a545_0x702178 = a545_0x1978;
(function (_0x19bbac, _0xbb4bbf) {
  const _0x4bbabc = a545_0x1978,
    _0x22059a = _0x19bbac();
  while (!![]) {
    try {
      const _0x38a013 =
        (-parseInt(_0x4bbabc(0x143)) / 0x1) *
          (parseInt(_0x4bbabc(0xd3)) / 0x2) +
        (-parseInt(_0x4bbabc(0x121)) / 0x3) *
          (-parseInt(_0x4bbabc(0x100)) / 0x4) +
        (-parseInt(_0x4bbabc(0x109)) / 0x5) *
          (-parseInt(_0x4bbabc(0xa7)) / 0x6) +
        (-parseInt(_0x4bbabc(0x153)) / 0x7) *
          (parseInt(_0x4bbabc(0x164)) / 0x8) +
        parseInt(_0x4bbabc(0x151)) / 0x9 +
        (parseInt(_0x4bbabc(0x145)) / 0xa) *
          (-parseInt(_0x4bbabc(0x14d)) / 0xb) +
        (parseInt(_0x4bbabc(0x122)) / 0xc) * (parseInt(_0x4bbabc(0x10b)) / 0xd);
      if (_0x38a013 === _0xbb4bbf) break;
      else _0x22059a["push"](_0x22059a["shift"]());
    } catch (_0x24a460) {
      _0x22059a["push"](_0x22059a["shift"]());
    }
  }
})(a545_0x2c68, 0xf300c);
import {
  fetchUserShortcutsFromServer,
  saveUserShortcutsToServer,
} from "../../api/shortcutsApi.js";
const DEFAULT_PRESET_NAME = a545_0x702178(0xd9),
  ASHUO_PRESET_NAME = a545_0x702178(0x111),
  CUSTOM_PRESET_NAME = a545_0x702178(0xde);
export const DEFAULT_SHORTCUTS = {
  "zoom-in": { label: "放大", keys: ["Ctrl", "+"], group: "通用" },
  "zoom-out": {
    label: "缩小",
    keys: [a545_0x702178(0xec), "-"],
    group: "通用",
  },
  "fit-all": {
    label: a545_0x702178(0xc4),
    keys: [a545_0x702178(0xec), "0"],
    group: "通用",
  },
  minimap: { label: "小地图", keys: ["M"], group: "通用" },
  "pan-canvas": {
    label: a545_0x702178(0x9f),
    keys: [a545_0x702178(0xc3)],
    group: "通用",
  },
  copy: {
    label: a545_0x702178(0xf0),
    keys: [a545_0x702178(0xec), "C"],
    group: a545_0x702178(0x160),
  },
  "copy-media": {
    label: a545_0x702178(0x148),
    keys: [a545_0x702178(0xec), a545_0x702178(0xb2), "C"],
    group: a545_0x702178(0x160),
  },
  cut: { label: "剪切节点", keys: ["Ctrl", "X"], group: a545_0x702178(0x160) },
  "canvas-screenshot": {
    label: "画布截图",
    keys: [a545_0x702178(0xcf), "Q"],
    group: "编辑与选择",
  },
  "duplicate-with-edges": {
    label: a545_0x702178(0x105),
    keys: [a545_0x702178(0xcf)],
    group: a545_0x702178(0x160),
  },
  paste: {
    label: a545_0x702178(0x174),
    keys: [a545_0x702178(0xec), "V"],
    group: a545_0x702178(0x160),
  },
  undo: { label: "撤销", keys: ["Ctrl", "Z"], group: a545_0x702178(0x160) },
  redo: {
    label: "重做",
    keys: [a545_0x702178(0xec), "Y"],
    group: a545_0x702178(0x160),
  },
  delete: {
    label: a545_0x702178(0x113),
    keys: [a545_0x702178(0x11f)],
    alternateKeys: [[a545_0x702178(0x11f)], [a545_0x702178(0x9d)]],
    group: a545_0x702178(0x160),
  },
  "select-all": {
    label: "全选",
    keys: [a545_0x702178(0xec), "A"],
    group: a545_0x702178(0x160),
  },
  "multi-select": {
    label: a545_0x702178(0x180),
    keys: [a545_0x702178(0xb2)],
    group: a545_0x702178(0x160),
  },
  group: { label: "编组", keys: ["Ctrl", "G"], group: "编辑与选择" },
  ungroup: { label: "解组", keys: ["Ctrl", "Shift", "G"], group: "编辑与选择" },
  "align-feature": {
    label: a545_0x702178(0x17c),
    keys: [a545_0x702178(0x131)],
    group: "通用",
  },
  "grid-dots": { label: "显示网格点", keys: ["G"], group: a545_0x702178(0xd0) },
  "toggle-connection-lines": {
    label: "显示/隐藏连接线",
    keys: ["B"],
    group: "设置开关",
  },
  "toggle-selection-related-highlight": {
    label: a545_0x702178(0xd4),
    keys: [],
    group: a545_0x702178(0xd0),
  },
  "snap-guides": {
    label: a545_0x702178(0xda),
    keys: [a545_0x702178(0xb2), ";"],
    group: a545_0x702178(0xd0),
  },
  "snap-grid": {
    label: a545_0x702178(0xd2),
    keys: [a545_0x702178(0xb2), "G"],
    group: "设置开关",
  },
  "toggle-video-meta": {
    label: a545_0x702178(0xac),
    keys: [],
    group: "设置开关",
  },
  "toggle-title-follows-zoom": {
    label: "标题跟随画布缩放",
    keys: [],
    group: a545_0x702178(0xd0),
  },
  "toggle-media-node-resize": {
    label: "图像视频节点缩放",
    keys: [],
    group: "设置开关",
  },
  "toggle-prompt-box-resize": {
    label: a545_0x702178(0x162),
    keys: [],
    group: a545_0x702178(0xd0),
  },
  "toggle-node-avoid-overlap": {
    label: a545_0x702178(0xdf),
    keys: [],
    group: a545_0x702178(0xd0),
  },
  "reset-media-size": {
    label: a545_0x702178(0x14e),
    keys: [a545_0x702178(0xb2), "R"],
    group: a545_0x702178(0x160),
  },
  "add-reference": {
    label: a545_0x702178(0x154),
    keys: ["X"],
    group: a545_0x702178(0x160),
  },
  "create-text": { label: a545_0x702178(0xd5), keys: ["T"], group: "创建节点" },
  "create-comment-note": {
    label: a545_0x702178(0x106),
    keys: ["N"],
    group: "创建节点",
  },
  "create-ai-text": {
    label: "创建生成文本节点",
    keys: ["Q"],
    group: a545_0x702178(0x158),
  },
  "create-ai-image": {
    label: "创建生成图像节点",
    keys: ["W"],
    group: a545_0x702178(0x158),
  },
  "create-ai-video": {
    label: "创建生成视频节点",
    keys: ["E"],
    group: a545_0x702178(0x158),
  },
  "create-ai-audio": {
    label: a545_0x702178(0x12c),
    keys: ["R"],
    group: a545_0x702178(0x158),
  },
  "cut-edge": {
    label: a545_0x702178(0x137),
    keys: [a545_0x702178(0xec)],
    group: "编辑与选择",
  },
  save: {
    label: a545_0x702178(0xe8),
    keys: [a545_0x702178(0xec), "S"],
    group: "通用",
  },
  "open-settings": {
    label: a545_0x702178(0xff),
    keys: [a545_0x702178(0xec), ","],
    group: "通用",
  },
  "open-canvas-projects": {
    label: a545_0x702178(0xca),
    keys: [],
    group: a545_0x702178(0x14a),
  },
  "open-assets": { label: "打开资产", keys: [], group: "侧边栏" },
  "open-workflows": {
    label: "打开工作流",
    keys: [],
    group: a545_0x702178(0x14a),
  },
  "open-files": {
    label: a545_0x702178(0xd1),
    keys: [],
    group: a545_0x702178(0x14a),
  },
  "open-task-center": {
    label: a545_0x702178(0xb7),
    keys: [],
    group: a545_0x702178(0x14a),
  },
  "escape-all": {
    label: a545_0x702178(0xed),
    keys: [a545_0x702178(0x110)],
    group: "通用",
    hidden: !![],
  },
  "editor-tool-brush": {
    label: a545_0x702178(0xaf),
    keys: ["B"],
    group: a545_0x702178(0xcb),
  },
  "editor-tool-rect": { label: "矩形", keys: [], group: "画笔功能" },
  "editor-tool-eraser": {
    label: "橡皮擦",
    keys: ["E"],
    group: a545_0x702178(0xcb),
  },
  "editor-tool-bucket": {
    label: a545_0x702178(0x13c),
    keys: ["G"],
    group: a545_0x702178(0xcb),
  },
  "editor-clear": { label: "清空", keys: ["R"], group: "画笔功能" },
  "image-tool-matting": {
    label: "遮罩编辑器",
    keys: ["1"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-repaint": {
    label: "重绘",
    keys: ["2"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-erase": {
    label: "擦除",
    keys: ["3"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-hd": { label: "高清", keys: ["4"], group: "图像功能" },
  "image-tool-expand": {
    label: "扩图",
    keys: ["5"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-auto-subject": {
    label: a545_0x702178(0x147),
    keys: ["6"],
    group: "图像功能",
  },
  "image-tool-multigrid": {
    label: a545_0x702178(0xc7),
    keys: ["7"],
    group: "图像功能",
  },
  "image-tool-multiangle": {
    label: a545_0x702178(0xbf),
    keys: ["8"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-annotate": {
    label: "标注",
    keys: ["9"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-crop": {
    label: "裁剪",
    keys: ["0"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-fullscreen": {
    label: a545_0x702178(0x140),
    keys: ["-"],
    group: a545_0x702178(0x12d),
  },
  "image-tool-download": {
    label: "下载",
    keys: ["="],
    group: a545_0x702178(0x12d),
  },
  "video-tool-clip": {
    label: a545_0x702178(0xd6),
    keys: ["1"],
    group: a545_0x702178(0x127),
  },
  "video-tool-separate-av": {
    label: a545_0x702178(0xee),
    keys: ["6"],
    group: a545_0x702178(0x127),
  },
  "video-tool-capture-frame": {
    label: a545_0x702178(0xbb),
    keys: ["C"],
    group: "视频功能",
  },
  "video-tool-keying": {
    label: "抠像",
    keys: ["2"],
    group: a545_0x702178(0x127),
  },
  "video-tool-hd": { label: "高清", keys: ["3"], group: a545_0x702178(0x127) },
  "video-tool-fullscreen": {
    label: a545_0x702178(0x140),
    keys: ["4"],
    group: a545_0x702178(0x127),
  },
  "video-tool-download": { label: "下载", keys: ["5"], group: "视频功能" },
  "audio-tool-clip": {
    label: a545_0x702178(0xb6),
    keys: ["1"],
    group: a545_0x702178(0xe1),
  },
  "audio-tool-speed": {
    label: "倍速",
    keys: ["2"],
    group: a545_0x702178(0xe1),
  },
  "audio-tool-download": { label: "下载", keys: ["3"], group: "音频功能" },
  "clip-tool-crop": {
    label: a545_0x702178(0x14f),
    keys: ["C"],
    group: a545_0x702178(0x146),
  },
  "text-tool-copy": { label: "复制", keys: ["1"], group: "文本功能" },
  "text-tool-fullscreen": {
    label: "全屏显示",
    keys: ["2"],
    group: a545_0x702178(0xfa),
  },
  "panorama-scene-tool-toggle-mouse": {
    label: "鼠标",
    keys: ["V"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-tool-move": {
    label: "移动",
    keys: ["W"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-tool-scale": {
    label: "缩放",
    keys: ["E"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-tool-rotate": {
    label: "旋转",
    keys: ["R"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-reset-view": {
    label: a545_0x702178(0x16d),
    keys: [],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-capture": { label: "截图", keys: ["C"], group: "3D导演台" },
  "panorama-scene-camera-create": {
    label: a545_0x702178(0x123),
    keys: ["`"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-1": {
    label: a545_0x702178(0x117),
    keys: ["1"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-2": {
    label: a545_0x702178(0x166),
    keys: ["2"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-3": {
    label: a545_0x702178(0xe7),
    keys: ["3"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-4": {
    label: a545_0x702178(0x17a),
    keys: ["4"],
    group: "3D导演台",
  },
  "panorama-scene-camera-5": {
    label: a545_0x702178(0xbd),
    keys: ["5"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-6": {
    label: a545_0x702178(0xf9),
    keys: ["6"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-7": {
    label: "跳转机位书签\x207",
    keys: ["7"],
    group: "3D导演台",
  },
  "panorama-scene-camera-8": {
    label: "跳转机位书签\x208",
    keys: ["8"],
    group: "3D导演台",
  },
  "panorama-scene-camera-9": {
    label: a545_0x702178(0xcc),
    keys: ["9"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-0": {
    label: a545_0x702178(0x126),
    keys: [],
    group: "3D导演台",
  },
  "panorama-scene-camera-save-1": {
    label: a545_0x702178(0x116),
    keys: [a545_0x702178(0xec), "1"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-2": {
    label: "保存当前视图到机位书签\x202",
    keys: [a545_0x702178(0xec), "2"],
    group: "3D导演台",
  },
  "panorama-scene-camera-save-3": {
    label: a545_0x702178(0x15c),
    keys: ["Ctrl", "3"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-4": {
    label: a545_0x702178(0x128),
    keys: ["Ctrl", "4"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-5": {
    label: a545_0x702178(0xa2),
    keys: [a545_0x702178(0xec), "5"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-6": {
    label: a545_0x702178(0x115),
    keys: [a545_0x702178(0xec), "6"],
    group: "3D导演台",
  },
  "panorama-scene-camera-save-7": {
    label: "保存当前视图到机位书签\x207",
    keys: [a545_0x702178(0xec), "7"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-8": {
    label: a545_0x702178(0x125),
    keys: ["Ctrl", "8"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-9": {
    label: a545_0x702178(0xf5),
    keys: [a545_0x702178(0xec), "9"],
    group: a545_0x702178(0x101),
  },
  "panorama-scene-camera-save-0": {
    label: "保存当前视图到机位书签\x2010",
    keys: [],
    group: "3D导演台",
  },
};
export const PRESETS = {
  [DEFAULT_PRESET_NAME]: {},
  [ASHUO_PRESET_NAME]: {
    "fit-all": ["F"],
    redo: [a545_0x702178(0xec), "Shift", "Z"],
    delete: ["D"],
    "snap-guides": [";"],
    "snap-grid": ["L"],
    "grid-dots": ["."],
    "create-text": [],
    "open-settings": ["K"],
    "open-assets": ["A"],
    "open-files": ["Z"],
  },
};
const BUILTIN_PRESET_NAMES = new Set(Object[a545_0x702178(0x11d)](PRESETS));
let _shortcuts = {},
  _currentPreset = ASHUO_PRESET_NAME,
  _recordingAction = null;
const DEFAULT_SHORTCUT_MIGRATIONS = {
    "panorama-scene-tool-move": { from: ["Q"], to: ["W"] },
    "panorama-scene-tool-scale": { from: ["W"], to: ["E"] },
    "panorama-scene-tool-rotate": { from: ["E"], to: ["R"] },
    "panorama-scene-reset-view": { from: ["R"], to: [] },
  },
  ASHUO_PRESET_SHORTCUT_MIGRATIONS = {
    "open-assets": { from: [], to: ["A"] },
    "open-files": { from: [], to: ["Z"] },
  },
  BUILTIN_PRESET_SHORTCUT_MIGRATIONS = {
    "add-reference": { from: [], to: ["X"] },
  };
function _emitShortcutsUpdated() {
  const _0x603f59 = a545_0x702178;
  window[_0x603f59(0x10f)](new CustomEvent("shortcuts-updated"));
}
const _TOOLBAR_SHORTCUT_PREFIX_BY_NODE_TYPE = {
    "source-image": "image-tool-",
    "ai-image": "image-tool-",
    image: a545_0x702178(0x107),
    "source-video": a545_0x702178(0xe0),
    "ai-video": a545_0x702178(0xe0),
    video: "video-tool-",
    "source-audio": a545_0x702178(0x13f),
    "ai-audio": a545_0x702178(0x13f),
    audio: a545_0x702178(0x13f),
    "media-clip": "clip-tool-",
    "source-text": a545_0x702178(0xbc),
    "ai-text": a545_0x702178(0xbc),
    text: a545_0x702178(0xbc),
  },
  _PANORAMA_SCENE_NODE_TYPES = new Set([
    a545_0x702178(0xc1),
    a545_0x702178(0xe9),
  ]);
function _isPanoramaSceneShortcut(_0x25a349) {
  const _0x488c03 = a545_0x702178,
    _0x466a84 = String(_0x25a349 || "")[_0x488c03(0x15a)]();
  return (
    _0x466a84[_0x488c03(0x13b)](_0x488c03(0x16c)) ||
    _0x466a84[_0x488c03(0x13b)](_0x488c03(0x13e)) ||
    _0x466a84["startsWith"]("panorama-scene-camera-save-") ||
    _0x466a84 === "panorama-scene-camera-create" ||
    _0x466a84 === "panorama-scene-reset-view" ||
    _0x466a84 === _0x488c03(0x177)
  );
}
function _isNodeToolbarAction(_0x1aa0e4) {
  const _0x3e282d = a545_0x702178;
  return /^(image|video|audio|clip|text)-tool-/[_0x3e282d(0x13a)](
    String(_0x1aa0e4 || ""),
  );
}
function _isEditorShortcut(_0x5f2dae) {
  const _0xd44754 = a545_0x702178;
  return String(_0x5f2dae || "")
    [_0xd44754(0x15a)]()
    [_0xd44754(0x13b)](_0xd44754(0x11a));
}
function _isCreateNodeShortcut(_0xe9b8c9) {
  const _0x1340cb = a545_0x702178;
  return String(_0xe9b8c9 || "")
    ["trim"]()
    [_0x1340cb(0x13b)](_0x1340cb(0x149));
}
function _isGlobalShortcut(_0x342935) {
  const _0x46b382 = a545_0x702178,
    _0x9a88e9 = String(_0x342935 || "")[_0x46b382(0x15a)]();
  if (!_0x9a88e9) return ![];
  return (
    !_isEditorShortcut(_0x9a88e9) &&
    !_isNodeToolbarAction(_0x9a88e9) &&
    !_isPanoramaSceneShortcut(_0x9a88e9) &&
    !_isCreateNodeShortcut(_0x9a88e9)
  );
}
function a545_0x2c68() {
  const _0x38c4e3 = [
    "featureModeActive",
    "success",
    "sc-keys",
    "matting-auto",
    "isArray",
    "panorama-scene-tool-",
    "重置视角",
    "backquote",
    "sc-section",
    "contains",
    "已切换预设：",
    "focus",
    "」占用",
    "粘贴节点",
    "showToast",
    "shiftKey",
    "panorama-scene-capture",
    "is-active",
    "keydown",
    "跳转机位书签\x204",
    "sc-item",
    "多选对齐功能",
    "createElement",
    "setAttribute",
    "div",
    "多选节点（配合点击）",
    "btnShortcutsClose",
    "Backspace",
    "fromEntries",
    "拖动画布（按住）",
    "display",
    "ctrl",
    "保存当前视图到机位书签\x205",
    "remove",
    "classList",
    "pane",
    "alt",
    "36yLksPr",
    "action",
    "[shortcuts]\x20save\x20failed:",
    "has",
    "activeElement",
    "视频节点信息",
    "alignFeatureEnabled",
    "Enter",
    "画笔（切换模式）",
    "push",
    "is-open",
    "Shift",
    "click",
    "metaKey",
    "false",
    "裁剪音频",
    "打开任务进程",
    "forEach",
    "aria-expanded",
    "shortcutsPresetMenu",
    "截取当前帧",
    "text-tool-",
    "跳转机位书签\x205",
    "toUpperCase",
    "控制角度",
    "true",
    "panorama-scene",
    "toggle",
    "Space",
    "聚焦节点/适应画布",
    "max",
    "undefined",
    "宫格裁剪",
    "stopPropagation",
    "replaceChildren",
    "打开画布项目",
    "画笔功能",
    "跳转机位书签\x209",
    "stopImmediatePropagation",
    "appendChild",
    "Alt",
    "设置开关",
    "打开文件管理",
    "网格吸附开关",
    "220918AwQYoD",
    "点击节点时高亮关联节点",
    "创建源文本节点",
    "裁剪视频",
    "kbd",
    "filter",
    "默认预设",
    "辅助线吸附",
    "open",
    "presetSelectBound",
    "selectedNodeType",
    "用户自定义",
    "新节点自动避让",
    "video-tool-",
    "音频功能",
    "DOMContentLoaded",
    "shortcutsPresetSelect",
    "code",
    "editor-tool-eraser",
    "videoKeyingActive",
    "跳转机位书签\x203",
    "保存画布",
    "panorama-360",
    "shortcutsPresetTrigger",
    "findIndex",
    "Ctrl",
    "取消/关闭所有菜单弹窗",
    "音画分离",
    "editor-clear",
    "复制节点",
    "preset",
    "length",
    "kbd-v2\x20recording",
    "meta",
    "保存当前视图到机位书签\x209",
    "disabled",
    "aria-selected",
    "block",
    "跳转机位书签\x206",
    "文本功能",
    "ctrlKey",
    "label",
    "indexOf",
    "includes",
    "打开设置",
    "1964mMYtoc",
    "3D导演台",
    ".settings-pane",
    "span",
    "style",
    "拖拽创建连线副本",
    "创建注释节点",
    "image-tool-",
    "未设置",
    "176825mfpOQc",
    "find",
    "97903XcouzQ",
    "closest",
    ".settings-nav-item",
    "warn",
    "dispatchEvent",
    "Escape",
    "创作预设",
    "btnShortcuts",
    "删除节点",
    "querySelectorAll",
    "保存当前视图到机位书签\x206",
    "保存当前视图到机位书签\x201",
    "跳转机位书签\x201",
    "toggle-connection-lines",
    "control",
    "editor-",
    "avatarMenu",
    "value",
    "keys",
    "every",
    "Delete",
    "textContent",
    "10905skHHFV",
    "3756RqyzLT",
    "创建机位书签",
    "快捷键冲突：已被「",
    "保存当前视图到机位书签\x208",
    "跳转机位书签\x2010",
    "视频功能",
    "保存当前视图到机位书签\x204",
    "object",
    "pan-canvas",
    "hidden",
    "创建生成音频节点",
    "图像功能",
    "settingsOverlay",
    "getElementById",
    "sc-section-title",
    "Tab",
    "pane-shortcuts",
    "altKey",
    "key",
    "editor-tool-brush",
    "function",
    "剪刀（切断连线）",
    "group",
    "preventDefault",
    "test",
    "startsWith",
    "油漆桶",
    "addEventListener",
    "panorama-scene-camera-",
    "audio-tool-",
    "全屏显示",
    "btnResetShortcuts",
    "shortcuts",
    "5CoWjXF",
    "entries",
    "7326740mxPdEp",
    "剪辑功能",
    "自动识别主体",
    "复制图像",
    "create-",
    "侧边栏",
    "from",
    "dataset",
    "22yJGaZz",
    "恢复节点默认大小",
    "剪辑裁剪",
    "panoramaSceneEditing",
    "3597597xYRsAH",
    "map",
    "108808qVRcXC",
    "添加参考",
    "target",
    "已恢复默认快捷键",
    "className",
    "创建节点",
    "savedPresetName",
    "trim",
    "change",
    "保存当前视图到机位书签\x203",
    "alternateKeys",
    "editor-tool-bucket",
    "快捷键已更新",
    "编辑与选择",
    ".settings-preset-option",
    "允许提示词栏下拉",
    "kbd-v2",
    "896FwMizI",
    "Backquote",
    "跳转机位书签\x202",
  ];
  a545_0x2c68 = function () {
    return _0x38c4e3;
  };
  return a545_0x2c68();
}
function _isPanoramaSceneNodeType(_0x4f665f) {
  const _0x36f3a8 = a545_0x702178;
  return _PANORAMA_SCENE_NODE_TYPES[_0x36f3a8(0xaa)](
    String(_0x4f665f || "")[_0x36f3a8(0x15a)](),
  );
}
function _isPanoramaSceneEditingContext(_0x59d555) {
  const _0x19322d = a545_0x702178;
  return (
    _isPanoramaSceneNodeType(_0x59d555?.[_0x19322d(0xdd)]) &&
    _0x59d555?.[_0x19322d(0x150)] === !![]
  );
}
function _filterShortcutMatchesByContext(_0x2d6d77, _0x334ef2 = {}) {
  const _0x51bd26 = a545_0x702178;
  let _0x25a928 = Array[_0x51bd26(0x16b)](_0x2d6d77) ? [..._0x2d6d77] : [];
  return (
    _0x334ef2[_0x51bd26(0x167)] &&
      (_0x25a928 = _0x25a928[_0x51bd26(0xd8)](
        (_0x51cfbe) => !_isNodeToolbarAction(_0x51cfbe),
      )),
    _0x334ef2[_0x51bd26(0xad)] === ![] &&
      (_0x25a928 = _0x25a928[_0x51bd26(0xd8)](
        (_0x59c8c1) => _0x59c8c1 !== "align-feature",
      )),
    _0x334ef2["mediaClipExpandedEditing"] === !![] &&
      (_0x25a928 = _0x25a928[_0x51bd26(0xd8)](
        (_0xb38e5f) => _0xb38e5f !== _0x51bd26(0x12a),
      )),
    _isPanoramaSceneEditingContext(_0x334ef2) &&
      (_0x25a928 = _0x25a928[_0x51bd26(0xd8)](
        (_0x18446d) =>
          !_isNodeToolbarAction(_0x18446d) && !_isCreateNodeShortcut(_0x18446d),
      )),
    _0x25a928
  );
}
function _resolveToolbarShortcutMatch(_0xb2b398, _0x4ebd27) {
  const _0x3cdb62 = a545_0x702178,
    _0x5bb490 =
      _TOOLBAR_SHORTCUT_PREFIX_BY_NODE_TYPE[
        String(_0x4ebd27 || "")[_0x3cdb62(0x15a)]()
      ];
  if (!_0x5bb490) return null;
  return (
    _0xb2b398[_0x3cdb62(0x10a)]((_0x39a057) =>
      _0x39a057[_0x3cdb62(0x13b)](_0x5bb490),
    ) || null
  );
}
function _resolveShortcutMatch(_0x2739b8, _0x3fb1f3 = {}) {
  const _0x554345 = a545_0x702178;
  if (!Array[_0x554345(0x16b)](_0x2739b8) || _0x2739b8["length"] === 0x0)
    return null;
  if (
    _0x3fb1f3["mattingActive"] ||
    _0x3fb1f3["annotateActive"] ||
    _0x3fb1f3[_0x554345(0xe6)]
  ) {
    const _0x5b4288 = _0x2739b8["find"]((_0xf8734e) =>
      _isEditorShortcut(_0xf8734e),
    );
    if (_0x5b4288) return _0x5b4288;
  }
  if (_isPanoramaSceneEditingContext(_0x3fb1f3)) {
    const _0x4be41d = _0x2739b8[_0x554345(0x10a)]((_0x13e00c) =>
      _isPanoramaSceneShortcut(_0x13e00c),
    );
    if (_0x4be41d) return _0x4be41d;
  }
  const _0x5d2b2d = _resolveToolbarShortcutMatch(
    _0x2739b8,
    _0x3fb1f3[_0x554345(0xdd)],
  );
  if (_0x5d2b2d) return _0x5d2b2d;
  const _0x1dfc12 = _0x2739b8[_0x554345(0x10a)]((_0x14ad82) =>
    _isGlobalShortcut(_0x14ad82),
  );
  if (_0x1dfc12) return _0x1dfc12;
  const _0x1936ef = _0x2739b8[_0x554345(0x10a)]((_0x92be1c) =>
    _isCreateNodeShortcut(_0x92be1c),
  );
  if (_0x1936ef) return _0x1936ef;
  return null;
}
function _getShortcutBindingStrings(_0x1dfe5c) {
  const _0x131090 = a545_0x702178,
    _0x37ef7d = [];
  return (
    Array[_0x131090(0x16b)](_0x1dfe5c?.["keys"]) &&
      _0x1dfe5c["keys"][_0x131090(0xf2)] > 0x0 &&
      _0x37ef7d[_0x131090(0xb0)](_0x1dfe5c[_0x131090(0x11d)]),
    Array[_0x131090(0x16b)](_0x1dfe5c?.[_0x131090(0x15d)]) &&
      _0x1dfe5c[_0x131090(0x15d)]["forEach"]((_0x20c1b2) => {
        const _0x4d4db4 = _0x131090;
        Array[_0x4d4db4(0x16b)](_0x20c1b2) &&
          _0x20c1b2[_0x4d4db4(0xf2)] > 0x0 &&
          _0x37ef7d[_0x4d4db4(0xb0)](_0x20c1b2);
      }),
    _0x37ef7d[_0x131090(0x152)]((_0x473185) =>
      _toShortcutBindingString(_0x473185),
    )
  );
}
function _normalizeShortcutToken(_0x5e9512) {
  const _0x256ace = a545_0x702178,
    _0x5e005a = String(_0x5e9512 || "")[_0x256ace(0x15a)]();
  if (!_0x5e005a) return "";
  const _0x34bd60 = _0x5e005a["toLowerCase"]();
  if (
    _0x34bd60 === _0x256ace(0xa1) ||
    _0x34bd60 === _0x256ace(0x119) ||
    _0x34bd60 === _0x256ace(0xf4)
  )
    return _0x256ace(0xec);
  if (_0x34bd60 === "shift") return _0x256ace(0xb2);
  if (_0x34bd60 === _0x256ace(0xa6)) return _0x256ace(0xcf);
  if (_0x34bd60 === "space") return _0x256ace(0xc3);
  if (_0x34bd60 === _0x256ace(0x16e) || _0x5e005a === "`" || _0x5e005a === "~")
    return "`";
  if (_0x5e005a["length"] === 0x1) return _0x5e005a["toUpperCase"]();
  return _0x5e005a;
}
function _normalizeShortcutMainKey(_0xe75c1) {
  const _0xe0a0ca = a545_0x702178;
  if (String(_0xe75c1?.[_0xe0a0ca(0xe4)] || "")["trim"]() === _0xe0a0ca(0x165))
    return "`";
  if (String(_0xe75c1?.[_0xe0a0ca(0xe4)] || "")[_0xe0a0ca(0x15a)]() === "Space")
    return _0xe0a0ca(0xc3);
  return _normalizeShortcutToken(
    _0xe75c1?.[_0xe0a0ca(0x134)] === "\x20"
      ? _0xe0a0ca(0xc3)
      : _0xe75c1?.[_0xe0a0ca(0x134)],
  );
}
function a545_0x1978(_0xff7b3e, _0xd330e1) {
  const _0x2c6834 = a545_0x2c68();
  return (
    (a545_0x1978 = function (_0x1978b1, _0x562456) {
      _0x1978b1 = _0x1978b1 - 0x9c;
      let _0x35bcf3 = _0x2c6834[_0x1978b1];
      return _0x35bcf3;
    }),
    a545_0x1978(_0xff7b3e, _0xd330e1)
  );
}
function _normalizeShortcutKeys(_0x4b8886) {
  const _0x276011 = a545_0x702178;
  if (!Array[_0x276011(0x16b)](_0x4b8886)) return [];
  const _0x7399da = _0x4b8886[_0x276011(0x152)]((_0x2ee961) =>
      _normalizeShortcutToken(_0x2ee961),
    )[_0x276011(0xd8)](Boolean),
    _0x3c25de = [];
  if (_0x7399da[_0x276011(0xfe)](_0x276011(0xec)))
    _0x3c25de[_0x276011(0xb0)]("Ctrl");
  if (_0x7399da[_0x276011(0xfe)](_0x276011(0xb2)))
    _0x3c25de[_0x276011(0xb0)]("Shift");
  if (_0x7399da[_0x276011(0xfe)](_0x276011(0xcf)))
    _0x3c25de["push"](_0x276011(0xcf));
  const _0x1699f1 = _0x7399da["filter"](
    (_0x1bca45) =>
      _0x1bca45 !== _0x276011(0xec) &&
      _0x1bca45 !== _0x276011(0xb2) &&
      _0x1bca45 !== _0x276011(0xcf),
  );
  return [..._0x3c25de, ..._0x1699f1];
}
function _buildShortcutKeysFromEvent(_0x410eef) {
  const _0x789210 = a545_0x702178,
    _0x163c0e = [];
  if (_0x410eef[_0x789210(0xfb)] || _0x410eef[_0x789210(0xb4)])
    _0x163c0e["push"](_0x789210(0xec));
  if (_0x410eef[_0x789210(0x176)]) _0x163c0e["push"]("Shift");
  if (_0x410eef[_0x789210(0x133)]) _0x163c0e[_0x789210(0xb0)](_0x789210(0xcf));
  const _0x14f60f = _normalizeShortcutMainKey(_0x410eef);
  return (
    ![_0x789210(0xec), _0x789210(0xb2), _0x789210(0xcf), ""][_0x789210(0xfe)](
      _0x14f60f,
    ) && _0x163c0e[_0x789210(0xb0)](_0x14f60f),
    _0x163c0e
  );
}
function _toShortcutBindingString(_0x46593a) {
  const _0x43b4c6 = a545_0x702178;
  return _normalizeShortcutKeys(_0x46593a)["join"]("+")[_0x43b4c6(0xbe)]();
}
function _isContextualShortcutConflictExempt(_0x3db71, _0x254653, _0x5b388c) {
  const _0x2f8c62 = a545_0x702178;
  if (_0x5b388c !== "B") return ![];
  const _0x33338e = new Set([_0x3db71, _0x254653]);
  return (
    _0x33338e[_0x2f8c62(0xaa)](_0x2f8c62(0x118)) &&
    _0x33338e[_0x2f8c62(0xaa)](_0x2f8c62(0x135))
  );
}
function _resolveSavedShortcutKeys(
  _0xd3fb50,
  _0x12587e,
  _0xfaa96b,
  _0xe3fe09 = {},
) {
  const _0x5872fa = a545_0x702178,
    _0x584d80 = Array[_0x5872fa(0x16b)](_0x12587e),
    _0x1104c4 = _0x584d80 ? _normalizeShortcutKeys(_0x12587e) : [],
    _0x510006 =
      _0xe3fe09[_0x5872fa(0x159)] === ASHUO_PRESET_NAME
        ? ASHUO_PRESET_SHORTCUT_MIGRATIONS[_0xd3fb50]
        : null,
    _0x4332e5 = BUILTIN_PRESET_NAMES[_0x5872fa(0xaa)](
      _0xe3fe09["savedPresetName"],
    )
      ? BUILTIN_PRESET_SHORTCUT_MIGRATIONS[_0xd3fb50]
      : null;
  if (
    _0x584d80 &&
    _0x510006 &&
    _toShortcutBindingString(_0x1104c4) ===
      _toShortcutBindingString(_0x510006[_0x5872fa(0x14b)])
  )
    return _normalizeShortcutKeys(_0x510006["to"]);
  if (
    _0x584d80 &&
    _0x4332e5 &&
    _toShortcutBindingString(_0x1104c4) ===
      _toShortcutBindingString(_0x4332e5["from"])
  )
    return _normalizeShortcutKeys(_0x4332e5["to"]);
  const _0x48fa92 = DEFAULT_SHORTCUT_MIGRATIONS[_0xd3fb50];
  if (
    _0x584d80 &&
    _0x48fa92 &&
    _toShortcutBindingString(_0x1104c4) ===
      _toShortcutBindingString(_0x48fa92["from"])
  )
    return _normalizeShortcutKeys(_0x48fa92["to"]);
  return _0x584d80 ? _0x1104c4 : _normalizeShortcutKeys(_0xfaa96b);
}
function _normalizePresetName(_0x47d974) {
  const _0x2fd44a = a545_0x702178,
    _0x3e82fa = String(_0x47d974 || "")[_0x2fd44a(0x15a)]();
  if (_0x3e82fa === "自定义") return CUSTOM_PRESET_NAME;
  if (BUILTIN_PRESET_NAMES["has"](_0x3e82fa)) return _0x3e82fa;
  if (_0x3e82fa === CUSTOM_PRESET_NAME) return CUSTOM_PRESET_NAME;
  return ASHUO_PRESET_NAME;
}
function _buildPresetShortcuts(_0x82fe7c) {
  const _0x4a69cc = a545_0x702178,
    _0x355146 = _normalizePresetName(_0x82fe7c),
    _0x63bc6a = PRESETS[_0x355146] || {};
  return Object["fromEntries"](
    Object["entries"](DEFAULT_SHORTCUTS)[_0x4a69cc(0x152)](
      ([_0x9a63fa, _0x200da2]) => [
        _0x9a63fa,
        {
          ..._0x200da2,
          keys: _normalizeShortcutKeys(
            _0x63bc6a[_0x9a63fa] ?? [..._0x200da2[_0x4a69cc(0x11d)]],
          ),
        },
      ],
    ),
  );
}
function _shortcutsMatchPreset(_0x106d4c, _0x5ac42a) {
  const _0x54082d = a545_0x702178,
    _0x17a9cb = _buildPresetShortcuts(_0x5ac42a);
  return Object[_0x54082d(0x144)](_0x17a9cb)[_0x54082d(0x11e)](
    ([_0x1989ce, _0x5ef223]) => {
      const _0x3347ba = _0x54082d,
        _0x2a4bef = _0x106d4c?.[_0x1989ce]?.[_0x3347ba(0x11d)] || [];
      return (
        _toShortcutBindingString(_0x2a4bef) ===
        _toShortcutBindingString(_0x5ef223[_0x3347ba(0x11d)])
      );
    },
  );
}
function _inferPresetName(_0x350ac4, _0x49594b) {
  if (_normalizePresetName(_0x49594b) === CUSTOM_PRESET_NAME)
    return CUSTOM_PRESET_NAME;
  if (_shortcutsMatchPreset(_0x350ac4, DEFAULT_PRESET_NAME))
    return DEFAULT_PRESET_NAME;
  if (_shortcutsMatchPreset(_0x350ac4, ASHUO_PRESET_NAME))
    return ASHUO_PRESET_NAME;
  return CUSTOM_PRESET_NAME;
}
async function _loadFromServer() {
  const _0x29cdaf = a545_0x702178;
  try {
    const _0x4d2b3c = await fetchUserShortcutsFromServer();
    if (
      _0x4d2b3c &&
      _0x4d2b3c[_0x29cdaf(0x142)] &&
      Object[_0x29cdaf(0x11d)](_0x4d2b3c["shortcuts"])["length"] > 0x0
    ) {
      const _0x551f2 = _normalizePresetName(_0x4d2b3c[_0x29cdaf(0xf1)]),
        _0x2ccdfa = BUILTIN_PRESET_NAMES[_0x29cdaf(0xaa)](_0x551f2)
          ? _0x551f2
          : ASHUO_PRESET_NAME,
        _0x18bdec = _buildPresetShortcuts(_0x2ccdfa);
      ((_shortcuts = Object[_0x29cdaf(0x9e)](
        Object[_0x29cdaf(0x144)](_0x18bdec)[_0x29cdaf(0x152)](
          ([_0x5c8a9c, _0x2f5043]) => [
            _0x5c8a9c,
            _0x4d2b3c[_0x29cdaf(0x142)][_0x5c8a9c]
              ? {
                  ..._0x2f5043,
                  keys: _resolveSavedShortcutKeys(
                    _0x5c8a9c,
                    _0x4d2b3c["shortcuts"][_0x5c8a9c][_0x29cdaf(0x11d)],
                    _0x2f5043[_0x29cdaf(0x11d)],
                    { savedPresetName: _0x551f2 },
                  ),
                }
              : {
                  ..._0x2f5043,
                  keys: _normalizeShortcutKeys(_0x2f5043["keys"]),
                },
          ],
        ),
      )),
        (_currentPreset = _inferPresetName(_shortcuts, _0x551f2)));
      if (_shortcuts[_0x29cdaf(0x16a)])
        _shortcuts[_0x29cdaf(0x16a)]["keys"] = [];
      (_updatePresetSelect(), _render(), _syncShortcutsToGlobal());
    } else (_applyPreset(ASHUO_PRESET_NAME, ![]), _syncShortcutsToGlobal());
  } catch {
    (_applyPreset(ASHUO_PRESET_NAME, ![]), _syncShortcutsToGlobal());
  }
}
async function _saveToServer() {
  const _0x282648 = a545_0x702178,
    _0x1e66ab = {
      preset: _currentPreset,
      shortcuts: Object[_0x282648(0x9e)](
        Object[_0x282648(0x144)](_shortcuts)[_0x282648(0x152)](
          ([_0x50a1b7, _0x1fe1a2]) => [
            _0x50a1b7,
            { keys: _0x1fe1a2[_0x282648(0x11d)] },
          ],
        ),
      ),
    };
  try {
    (await saveUserShortcutsToServer(_0x1e66ab), _syncShortcutsToGlobal());
  } catch (_0x4a0b2e) {
    console[_0x282648(0x10e)](_0x282648(0xa9), _0x4a0b2e);
  }
}
function _syncShortcutsToGlobal() {
  const _0x3361f3 = a545_0x702178,
    _0x2707c7 = {},
    _0x1b4921 = [
      _0x3361f3(0x135),
      _0x3361f3(0xe5),
      _0x3361f3(0x15e),
      _0x3361f3(0xef),
    ];
  (_0x1b4921["forEach"]((_0xcb0b5b) => {
    const _0x3ea82f = _0x3361f3;
    if (_shortcuts[_0xcb0b5b]?.[_0x3ea82f(0x11d)]?.[_0x3ea82f(0xf2)] > 0x0) {
      const _0x48fbd2 =
        _shortcuts[_0xcb0b5b][_0x3ea82f(0x11d)][
          _shortcuts[_0xcb0b5b]["keys"][_0x3ea82f(0xf2)] - 0x1
        ];
      _0x2707c7[_0xcb0b5b] = _0x48fbd2[_0x3ea82f(0xbe)]();
    }
  }),
    (window["_mattingShortcuts"] = _0x2707c7));
}
function _applyPreset(_0x5796bf, _0x26cb5d = !![]) {
  const _0x271dd4 = a545_0x702178,
    _0xa4870c = _normalizePresetName(_0x5796bf);
  if (!BUILTIN_PRESET_NAMES[_0x271dd4(0xaa)](_0xa4870c)) return;
  ((_currentPreset = _0xa4870c),
    (_shortcuts = _buildPresetShortcuts(_0xa4870c)),
    _render(),
    _syncShortcutsToGlobal(),
    _emitShortcutsUpdated());
  if (_0x26cb5d) _saveToServer();
}
function _getPresetControls() {
  const _0x5aa722 = a545_0x702178;
  if (typeof document === _0x5aa722(0xc6)) return {};
  const _0x33e15b = document[_0x5aa722(0x12f)](_0x5aa722(0xe3)),
    _0x319393 = document[_0x5aa722(0x12f)]("shortcutsPresetControl"),
    _0x590a67 = document["getElementById"](_0x5aa722(0xea)),
    _0x47bc01 = document[_0x5aa722(0x12f)]("shortcutsPresetTriggerText"),
    _0x3b7397 = document["getElementById"](_0x5aa722(0xba)),
    _0x1e21a8 = _0x3b7397?.[_0x5aa722(0x114)]
      ? Array[_0x5aa722(0x14b)](
          _0x3b7397[_0x5aa722(0x114)](".settings-preset-option"),
        )
      : [];
  return {
    select: _0x33e15b,
    control: _0x319393,
    trigger: _0x590a67,
    triggerText: _0x47bc01,
    menu: _0x3b7397,
    options: _0x1e21a8,
  };
}
function _getPresetLabel(_0x50e0f7) {
  const _0x3b2152 = a545_0x702178,
    { select: _0x23a78, options: _0x5e36d5 } = _getPresetControls(),
    _0x40c5e5 = _0x23a78?.["options"]
      ? Array["from"](_0x23a78["options"])[_0x3b2152(0x10a)](
          (_0x5a334b) => _0x5a334b[_0x3b2152(0x11c)] === _0x50e0f7,
        )
      : null,
    _0x631cae = _0x5e36d5[_0x3b2152(0x10a)](
      (_0x5cc715) => _0x5cc715["dataset"]?.[_0x3b2152(0x11c)] === _0x50e0f7,
    );
  return (
    _0x40c5e5?.[_0x3b2152(0x120)] || _0x631cae?.["textContent"] || _0x50e0f7
  );
}
function _setPresetMenuOpen(
  _0x5dbb66,
  { focusOption: focusOption = ![], focusTrigger: focusTrigger = ![] } = {},
) {
  const _0x18b6f9 = a545_0x702178,
    {
      control: _0x4f416f,
      trigger: _0x58fe23,
      menu: _0x4d7e63,
      options: _0x2f5285,
    } = _getPresetControls();
  if (!_0x4f416f || !_0x58fe23 || !_0x4d7e63) return;
  (_0x4f416f["classList"][_0x18b6f9(0xc2)](_0x18b6f9(0xb1), _0x5dbb66),
    _0x58fe23[_0x18b6f9(0x17e)](
      _0x18b6f9(0xb9),
      _0x5dbb66 ? _0x18b6f9(0xc0) : _0x18b6f9(0xb5),
    ),
    (_0x4d7e63[_0x18b6f9(0x12b)] = !_0x5dbb66));
  if (_0x5dbb66 && focusOption) {
    const _0x159d82 = _0x2f5285[_0x18b6f9(0x10a)](
        (_0x4d97ea) =>
          _0x4d97ea[_0x18b6f9(0x14c)]?.[_0x18b6f9(0x11c)] === _currentPreset &&
          !_0x4d97ea[_0x18b6f9(0xf6)],
      ),
      _0x3adb37 = _0x2f5285[_0x18b6f9(0x10a)](
        (_0x32d164) => !_0x32d164["disabled"],
      );
    (_0x159d82 || _0x3adb37)?.[_0x18b6f9(0x172)]?.();
  } else !_0x5dbb66 && focusTrigger && _0x58fe23[_0x18b6f9(0x172)]?.();
}
function _isPresetMenuOpen() {
  const _0xa8e469 = a545_0x702178,
    { control: _0x433619 } = _getPresetControls();
  return !!_0x433619?.[_0xa8e469(0xa4)]?.[_0xa8e469(0x170)]("is-open");
}
function _selectPresetFromUi(_0x2e649b) {
  const _0x2e3eab = a545_0x702178;
  if (_normalizePresetName(_0x2e649b) === CUSTOM_PRESET_NAME) {
    (_updatePresetSelect(), _setPresetMenuOpen(![], { focusTrigger: !![] }));
    return;
  }
  const _0x1c2bf1 = _normalizePresetName(_0x2e649b);
  (_applyPreset(_0x1c2bf1, !![]),
    _updatePresetSelect(),
    _setPresetMenuOpen(![], { focusTrigger: !![] }),
    window[_0x2e3eab(0x175)]?.(_0x2e3eab(0x171) + _0x1c2bf1));
}
function _movePresetOptionFocus(_0x510629) {
  const _0x3d5e7f = a545_0x702178,
    { options: _0x102ad4 } = _getPresetControls(),
    _0x5fa923 = _0x102ad4[_0x3d5e7f(0xd8)](
      (_0x43ea1a) => !_0x43ea1a["disabled"],
    );
  if (_0x5fa923[_0x3d5e7f(0xf2)] === 0x0) return;
  const _0xfc4956 = document[_0x3d5e7f(0xab)];
  let _0x1dd44b = _0x5fa923[_0x3d5e7f(0xfd)](_0xfc4956);
  _0x1dd44b < 0x0 &&
    (_0x1dd44b = _0x5fa923[_0x3d5e7f(0xeb)](
      (_0x3de811) =>
        _0x3de811[_0x3d5e7f(0x14c)]?.[_0x3d5e7f(0x11c)] === _currentPreset,
    ));
  const _0x275e36 =
    (Math[_0x3d5e7f(0xc5)](_0x1dd44b, 0x0) + _0x510629 + _0x5fa923["length"]) %
    _0x5fa923[_0x3d5e7f(0xf2)];
  _0x5fa923[_0x275e36]?.[_0x3d5e7f(0x172)]?.();
}
function _updatePresetSelect() {
  const _0x1a5d6c = a545_0x702178,
    {
      select: _0x3c2f27,
      triggerText: _0x4d219c,
      options: _0x5e1fe4,
    } = _getPresetControls();
  if (_0x3c2f27) _0x3c2f27[_0x1a5d6c(0x11c)] = _currentPreset;
  if (_0x4d219c) _0x4d219c[_0x1a5d6c(0x120)] = _getPresetLabel(_currentPreset);
  _0x5e1fe4[_0x1a5d6c(0xb8)]((_0xaecd72) => {
    const _0x37aea8 = _0x1a5d6c,
      _0x4b702b =
        _0xaecd72[_0x37aea8(0x14c)]?.[_0x37aea8(0x11c)] === _currentPreset;
    (_0xaecd72["classList"][_0x37aea8(0xc2)](_0x37aea8(0x178), _0x4b702b),
      _0xaecd72["setAttribute"](
        _0x37aea8(0xf7),
        _0x4b702b ? _0x37aea8(0xc0) : _0x37aea8(0xb5),
      ));
  });
}
function _initPresetSelect() {
  const _0x13d47e = a545_0x702178,
    {
      select: _0x5a692f,
      control: _0x3fa474,
      trigger: _0x38c95c,
      menu: _0x480faa,
    } = _getPresetControls();
  _0x5a692f &&
    !_0x5a692f[_0x13d47e(0x14c)][_0x13d47e(0xdc)] &&
    ((_0x5a692f[_0x13d47e(0x14c)][_0x13d47e(0xdc)] = _0x13d47e(0xc0)),
    _0x5a692f["addEventListener"](_0x13d47e(0x15b), () => {
      const _0xed4355 = _0x13d47e;
      _selectPresetFromUi(_0x5a692f[_0xed4355(0x11c)]);
    }));
  if (
    !_0x3fa474 ||
    !_0x38c95c ||
    !_0x480faa ||
    _0x38c95c["dataset"][_0x13d47e(0xdc)]
  ) {
    _updatePresetSelect();
    return;
  }
  ((_0x38c95c["dataset"][_0x13d47e(0xdc)] = _0x13d47e(0xc0)),
    _0x38c95c[_0x13d47e(0x13d)](_0x13d47e(0xb3), () => {
      _setPresetMenuOpen(!_isPresetMenuOpen(), { focusOption: !![] });
    }),
    _0x38c95c[_0x13d47e(0x13d)](_0x13d47e(0x179), (_0x47c1fa) => {
      const _0x1e34f9 = _0x13d47e;
      (_0x47c1fa[_0x1e34f9(0x134)] === "ArrowDown" ||
        _0x47c1fa[_0x1e34f9(0x134)] === "Enter" ||
        _0x47c1fa[_0x1e34f9(0x134)] === "\x20") &&
        (_0x47c1fa["preventDefault"](),
        _setPresetMenuOpen(!![], { focusOption: !![] }));
    }),
    _0x480faa["addEventListener"]("click", (_0x40b627) => {
      const _0x515b2e = _0x13d47e,
        _0x1b4492 = _0x40b627["target"]?.["closest"]?.(_0x515b2e(0x161));
      if (!_0x1b4492 || _0x1b4492[_0x515b2e(0xf6)]) return;
      _selectPresetFromUi(_0x1b4492["dataset"]["value"]);
    }),
    _0x480faa["addEventListener"](_0x13d47e(0x179), (_0x556430) => {
      const _0x170953 = _0x13d47e;
      if (_0x556430[_0x170953(0x134)] === "Escape")
        (_0x556430[_0x170953(0x139)](),
          _setPresetMenuOpen(![], { focusTrigger: !![] }));
      else {
        if (_0x556430[_0x170953(0x134)] === "ArrowDown")
          (_0x556430["preventDefault"](), _movePresetOptionFocus(0x1));
        else {
          if (_0x556430[_0x170953(0x134)] === "ArrowUp")
            (_0x556430[_0x170953(0x139)](), _movePresetOptionFocus(-0x1));
          else {
            if (
              _0x556430[_0x170953(0x134)] === _0x170953(0xae) ||
              _0x556430[_0x170953(0x134)] === "\x20"
            ) {
              _0x556430["preventDefault"]();
              const _0x16fdec = document[_0x170953(0xab)]?.[_0x170953(0x10c)]?.(
                ".settings-preset-option",
              );
              if (_0x16fdec && !_0x16fdec[_0x170953(0xf6)])
                _selectPresetFromUi(
                  _0x16fdec[_0x170953(0x14c)][_0x170953(0x11c)],
                );
            }
          }
        }
      }
    }),
    document["addEventListener"]("pointerdown", (_0x31e519) => {
      const _0x2a243a = _0x13d47e;
      if (!_isPresetMenuOpen()) return;
      if (
        typeof _0x3fa474[_0x2a243a(0x170)] === _0x2a243a(0x136) &&
        _0x3fa474[_0x2a243a(0x170)](_0x31e519[_0x2a243a(0x155)])
      )
        return;
      _setPresetMenuOpen(![]);
    }),
    _updatePresetSelect());
}
function _render() {
  const _0x17d328 = a545_0x702178,
    _0x340ae5 = document[_0x17d328(0x12f)]("shortcutsContent");
  if (!_0x340ae5) return;
  _0x340ae5[_0x17d328(0xc9)]();
  const _0x1bc8d0 = {};
  (Object[_0x17d328(0x144)](_shortcuts)[_0x17d328(0xb8)](
    ([_0x19cb63, _0x213aa9]) => {
      const _0x34a03b = _0x17d328;
      if (_0x213aa9[_0x34a03b(0x12b)]) return;
      if (!_0x1bc8d0[_0x213aa9[_0x34a03b(0x138)]])
        _0x1bc8d0[_0x213aa9[_0x34a03b(0x138)]] = [];
      _0x1bc8d0[_0x213aa9[_0x34a03b(0x138)]][_0x34a03b(0xb0)]({
        id: _0x19cb63,
        ..._0x213aa9,
      });
    },
  ),
    Object[_0x17d328(0x144)](_0x1bc8d0)[_0x17d328(0xb8)](
      ([_0x3a6fca, _0x47161c]) => {
        const _0x3c6db0 = _0x17d328,
          _0x394252 = document[_0x3c6db0(0x17d)]("div");
        _0x394252[_0x3c6db0(0x157)] = _0x3c6db0(0x16f);
        const _0x166a9c = document[_0x3c6db0(0x17d)](_0x3c6db0(0x17f));
        ((_0x166a9c[_0x3c6db0(0x157)] = _0x3c6db0(0x130)),
          (_0x166a9c["textContent"] = _0x3a6fca),
          _0x394252[_0x3c6db0(0xce)](_0x166a9c),
          _0x47161c["forEach"]((_0x1fab2a) => {
            const _0x927d76 = _0x3c6db0,
              _0x5a578d = document["createElement"]("div");
            _0x5a578d["className"] = _0x927d76(0x17b);
            const _0x48884c = document["createElement"](_0x927d76(0x103));
            ((_0x48884c[_0x927d76(0x157)] = "sc-label"),
              (_0x48884c[_0x927d76(0x120)] = _0x1fab2a[_0x927d76(0xfc)]));
            const _0xc2e15c = document[_0x927d76(0x17d)](_0x927d76(0x17f));
            ((_0xc2e15c[_0x927d76(0x157)] = _0x927d76(0x169)),
              (_0xc2e15c[_0x927d76(0x14c)][_0x927d76(0xa8)] = _0x1fab2a["id"]),
              _0xc2e15c[_0x927d76(0xc9)]());
            if (_recordingAction === _0x1fab2a["id"]) {
              const _0x3337ef = document[_0x927d76(0x17d)](_0x927d76(0xd7));
              ((_0x3337ef[_0x927d76(0x157)] = _0x927d76(0xf3)),
                (_0x3337ef[_0x927d76(0x120)] = "录制中..."),
                _0xc2e15c[_0x927d76(0xce)](_0x3337ef));
            } else {
              if (_0x1fab2a["keys"][_0x927d76(0xf2)] > 0x0)
                _0x1fab2a[_0x927d76(0x11d)][_0x927d76(0xb8)]((_0x40fe90) => {
                  const _0x282716 = _0x927d76,
                    _0xfb33b6 = document[_0x282716(0x17d)](_0x282716(0xd7));
                  ((_0xfb33b6["className"] = _0x282716(0x163)),
                    (_0xfb33b6[_0x282716(0x120)] = _0x40fe90),
                    _0xc2e15c[_0x282716(0xce)](_0xfb33b6));
                });
              else {
                const _0xb21c1d = document[_0x927d76(0x17d)](_0x927d76(0xd7));
                ((_0xb21c1d[_0x927d76(0x157)] = _0x927d76(0x163)),
                  (_0xb21c1d[_0x927d76(0x120)] = _0x927d76(0x108)),
                  _0xc2e15c[_0x927d76(0xce)](_0xb21c1d));
              }
            }
            (_0xc2e15c["addEventListener"](_0x927d76(0xb3), () =>
              _startRecording(_0x1fab2a["id"]),
            ),
              _0x5a578d[_0x927d76(0xce)](_0x48884c),
              _0x5a578d[_0x927d76(0xce)](_0xc2e15c),
              _0x394252[_0x927d76(0xce)](_0x5a578d));
          }),
          _0x340ae5[_0x3c6db0(0xce)](_0x394252));
      },
    ));
}
function _startRecording(_0x1c8274) {
  if (_recordingAction) return;
  ((_recordingAction = _0x1c8274), _render());
}
export function detectShortcutConflict(_0x53ab65, _0xe31cf2, _0x268a18) {
  const _0x756f77 = a545_0x702178;
  if (!_0x53ab65 || typeof _0x53ab65 !== _0x756f77(0x129)) return null;
  const _0x5aca0e = _toShortcutBindingString(_0x268a18);
  if (!_0x5aca0e) return null;
  for (const [_0x4a9e6c, _0x558995] of Object[_0x756f77(0x144)](_0x53ab65)) {
    if (_0x4a9e6c === _0xe31cf2) continue;
    if (_getShortcutBindingStrings(_0x558995)[_0x756f77(0xfe)](_0x5aca0e)) {
      if (_isContextualShortcutConflictExempt(_0xe31cf2, _0x4a9e6c, _0x5aca0e))
        continue;
      return { id: _0x4a9e6c, label: _0x558995[_0x756f77(0xfc)] || _0x4a9e6c };
    }
  }
  return null;
}
function _stopRecording(_0x5418df) {
  const _0x234aa1 = a545_0x702178;
  if (!_recordingAction) return;
  if (_0x5418df && _0x5418df[_0x234aa1(0xf2)] > 0x0) {
    const _0x1bff4a = detectShortcutConflict(
      _shortcuts,
      _recordingAction,
      _0x5418df,
    );
    if (_0x1bff4a) {
      (window["showToast"]?.(
        _0x234aa1(0x124) + _0x1bff4a[_0x234aa1(0xfc)] + _0x234aa1(0x173),
        _0x234aa1(0x10e),
      ),
        (_recordingAction = null),
        _render());
      return;
    }
    ((_shortcuts[_recordingAction][_0x234aa1(0x11d)] =
      _normalizeShortcutKeys(_0x5418df)),
      (_currentPreset = CUSTOM_PRESET_NAME),
      _updatePresetSelect(),
      _syncShortcutsToGlobal(),
      _emitShortcutsUpdated(),
      _saveToServer(),
      window[_0x234aa1(0x175)]?.(_0x234aa1(0x15f), _0x234aa1(0x168)));
  }
  ((_recordingAction = null), _render());
}
function _reset() {
  const _0x23d40f = a545_0x702178;
  (_applyPreset(DEFAULT_PRESET_NAME, !![]),
    _updatePresetSelect(),
    window["showToast"]?.(_0x23d40f(0x156)));
}
export function openShortcuts() {
  const _0x1a2ebf = a545_0x702178,
    _0x1d1ff7 = document[_0x1a2ebf(0x12f)](_0x1a2ebf(0x12e));
  if (!_0x1d1ff7) return;
  _0x1d1ff7[_0x1a2ebf(0x104)][_0x1a2ebf(0xa0)] = _0x1a2ebf(0xf8);
  const _0x1a21f0 = document[_0x1a2ebf(0x114)](_0x1a2ebf(0x10d)),
    _0x357c2c = document[_0x1a2ebf(0x114)](_0x1a2ebf(0x102));
  (_0x1a21f0[_0x1a2ebf(0xb8)]((_0x51b3f7) => {
    const _0x34dcc5 = _0x1a2ebf;
    _0x51b3f7["classList"][_0x34dcc5(0xc2)](
      "active",
      _0x51b3f7["dataset"][_0x34dcc5(0xa5)] === _0x34dcc5(0x142),
    );
  }),
    _0x357c2c[_0x1a2ebf(0xb8)]((_0x3ec688) => {
      const _0x4074f8 = _0x1a2ebf;
      _0x3ec688[_0x4074f8(0xa4)][_0x4074f8(0xc2)](
        "active",
        _0x3ec688["id"] === _0x4074f8(0x132),
      );
    }),
    _render(),
    _updatePresetSelect());
}
export function closeShortcuts() {
  const _0x1bd502 = a545_0x702178,
    _0x41a1ab = document[_0x1bd502(0x12f)](_0x1bd502(0x12e));
  if (_0x41a1ab) _0x41a1ab[_0x1bd502(0x104)][_0x1bd502(0xa0)] = "none";
  _recordingAction && ((_recordingAction = null), _render());
}
export function getShortcuts() {
  return _shortcuts;
}
export function getCurrentPreset() {
  return _currentPreset;
}
export function isRecording() {
  return !!_recordingAction;
}
export function handleShortcutKeydown(_0x43414d, _0x5b5273 = {}) {
  const _0x11ac34 = a545_0x702178;
  if (_recordingAction) return null;
  const _0x85818 = _toShortcutBindingString(
    _buildShortcutKeysFromEvent(_0x43414d),
  );
  let _0x245697 = [];
  for (const [_0x362f0d, _0x2144a8] of Object["entries"](_shortcuts)) {
    _getShortcutBindingStrings(_0x2144a8)[_0x11ac34(0xfe)](_0x85818) &&
      _0x245697[_0x11ac34(0xb0)](_0x362f0d);
  }
  _0x245697 = _filterShortcutMatchesByContext(_0x245697, _0x5b5273);
  if (_0x245697[_0x11ac34(0xf2)] === 0x0) return null;
  return _resolveShortcutMatch(_0x245697, _0x5b5273);
}
typeof document !== "undefined" &&
  document?.[a545_0x702178(0x13d)] &&
  (document[a545_0x702178(0x13d)](
    a545_0x702178(0x179),
    (_0x484ac4) => {
      const _0x96fe1c = a545_0x702178;
      if (!_recordingAction) return;
      (_0x484ac4[_0x96fe1c(0x139)](), _0x484ac4[_0x96fe1c(0xcd)]());
      if (_0x484ac4["key"] === "Escape") {
        _stopRecording(null);
        return;
      }
      const _0x45b7c4 = _buildShortcutKeysFromEvent(_0x484ac4),
        _0x54b95b = _normalizeShortcutMainKey(_0x484ac4);
      _0x45b7c4[_0x96fe1c(0xf2)] > 0x0 &&
        ![_0x96fe1c(0xec), _0x96fe1c(0xb2), _0x96fe1c(0xcf), ""]["includes"](
          _0x54b95b,
        ) &&
        _stopRecording(_0x45b7c4);
    },
    !![],
  ),
  document[a545_0x702178(0x13d)](a545_0x702178(0xe2), () => {
    const _0x239c7f = a545_0x702178;
    (_loadFromServer(),
      document[_0x239c7f(0x12f)](_0x239c7f(0x9c))?.[_0x239c7f(0x13d)](
        _0x239c7f(0xb3),
        closeShortcuts,
      ),
      document["getElementById"](_0x239c7f(0x141))?.["addEventListener"](
        _0x239c7f(0xb3),
        (_0x2eda88) => {
          const _0x14520b = _0x239c7f;
          (_0x2eda88[_0x14520b(0xc8)](), _reset());
        },
      ),
      document[_0x239c7f(0x12f)](_0x239c7f(0x9c))?.["addEventListener"](
        _0x239c7f(0xb3),
        closeShortcuts,
      ),
      document["getElementById"](_0x239c7f(0x112))?.[_0x239c7f(0x13d)](
        "click",
        (_0x26b81b) => {
          const _0x2efedf = _0x239c7f;
          (_0x26b81b[_0x2efedf(0xc8)](),
            document[_0x2efedf(0x12f)](_0x2efedf(0x11b))?.["classList"][
              _0x2efedf(0xa3)
            ](_0x2efedf(0xdb)),
            openShortcuts());
        },
      ),
      _initPresetSelect());
  }));
