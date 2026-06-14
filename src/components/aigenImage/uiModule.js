import { createAIGenerateNodeUiModule as createAIGenerateNodeUiModuleImpl } from './uiModule.impl.js';

const STATUS_CARD_ERROR_COLOR = 'var(--red)';

function isErrorStatusCode(statusCode) {
  const numericStatusCode = Number(statusCode);
  return Number.isFinite(numericStatusCode) && numericStatusCode !== 0;
}

function applyStatusCardErrorStyle(card, statusCode) {
  if (!card || !isErrorStatusCode(statusCode)) return card;
  card.innerHTML = String(card.innerHTML || '').replaceAll('var(--white-80)', STATUS_CARD_ERROR_COLOR);
  return card;
}

export function createAIGenerateNodeUiModule(options) {
  const uiModule = createAIGenerateNodeUiModuleImpl(options);
  const createStatusCard = uiModule?._createStatusCard;
  if (typeof createStatusCard !== 'function') return uiModule;

  uiModule._createStatusCard = function createStatusCardWithErrorStyle(message, statusCode, ...rest) {
    return applyStatusCardErrorStyle(createStatusCard.call(this, message, statusCode, ...rest), statusCode);
  };

  return uiModule;
}
