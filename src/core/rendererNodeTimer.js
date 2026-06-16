const RUNNING_STATUSES = new Set([
  'loading',
  'running',
  'pending',
  'processing',
  'queued',
  'submitted',
  'generating',
  'recovering',
]);

const TERMINAL_STATUSES = new Set([
  'success',
  'complete',
  'completed',
  'done',
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
  'interrupted',
]);

const DEFAULT_FORMAT_TIMER_TEXT = (_node, durationMs) => {
  const safeDuration = Math.max(0, Number(durationMs) || 0);
  const seconds = Math.floor(safeDuration / 1000);
  const tenth = Math.floor((safeDuration % 1000) / 100);
  return `${seconds}.${tenth}s`;
};

const collectStatusValues = (node) => [
  node.jobStatus,
  node.status,
  node.asyncTaskStatus,
  node.textTaskStatus,
  node.rhTaskStatus,
  node.dreaminaTaskStatus,
].map((value) => String(value || '').toLowerCase());

export function getNodeTimerRenderState(
  node,
  {
    now = Date.now(),
    isResolvedSourceMediaNode = () => false,
    formatTimerText = DEFAULT_FORMAT_TIMER_TEXT,
  } = {},
) {
  if (!node || isResolvedSourceMediaNode(node)) {
    return { visible: false, running: false, text: '' };
  }

  if (typeof node.generationDuration === 'number') {
    return { visible: false, running: false, text: '' };
  }

  const statusValues = collectStatusValues(node);
  const hasRunningStatus = statusValues.some((value) => RUNNING_STATUSES.has(value));
  const hasTerminalStatus = statusValues.some((value) => TERMINAL_STATUSES.has(value));

  if (node.generationStartTime && !hasTerminalStatus && (node.isGenerating === true || hasRunningStatus)) {
    return {
      visible: true,
      running: true,
      text: formatTimerText(node, now - node.generationStartTime),
    };
  }

  return { visible: false, running: false, text: '' };
}