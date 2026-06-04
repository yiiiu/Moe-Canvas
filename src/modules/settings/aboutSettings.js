import { openExternalLink } from '../../services/externalLinkService.js';

const readAppVersion = () => {
  const rawVersion = document.querySelector('meta[name="app-version"]')?.getAttribute('content');
  const version = String(rawVersion || '').trim().replace(/^v\s*/i, '');
  return version ? `V ${version}` : '-';
};

const readActiveCanvasName = () => {
  const activeTabName = String(
    document.querySelector('.canvas-tab.active .canvas-tab-name')?.textContent || '',
  ).trim();
  if (activeTabName) return activeTabName;

  const projectName = String(document.getElementById('projectNameText')?.textContent || '').trim();
  return projectName || '未命名画布';
};

const syncAboutInfo = () => {
  const versionEl = document.getElementById('settingsAboutVersion');
  const projectEl = document.getElementById('settingsAboutProject');
  if (versionEl) versionEl.textContent = readAppVersion();
  if (projectEl) projectEl.textContent = readActiveCanvasName();
};

const syncAboutInfoOnNextFrame = () => {
  requestAnimationFrame(syncAboutInfo);
};

const bindExternalLink = () => {
  document.querySelectorAll('#pane-about [data-external-url]').forEach((el) => {
    if (el.dataset.aboutExternalBound === '1') return;
    el.dataset.aboutExternalBound = '1';
    el.addEventListener('click', () => {
      const url = String(el.dataset.externalUrl || '').trim();
      if (url) openExternalLink(url);
    });
  });
};

const bindRefreshTriggers = () => {
  document.querySelectorAll('.settings-nav-item[data-pane="about"]').forEach((el) => {
    if (el.dataset.aboutRefreshBound === '1') return;
    el.dataset.aboutRefreshBound = '1';
    el.addEventListener('click', syncAboutInfo);
  });

  const openSettingsBtn = document.getElementById('btnOpenSettings');
  if (openSettingsBtn && openSettingsBtn.dataset.aboutRefreshBound !== '1') {
    openSettingsBtn.dataset.aboutRefreshBound = '1';
    openSettingsBtn.addEventListener('click', syncAboutInfoOnNextFrame);
  }

  const canvasTabs = document.getElementById('canvasTabs');
  if (canvasTabs && canvasTabs.dataset.aboutRefreshBound !== '1') {
    canvasTabs.dataset.aboutRefreshBound = '1';
    canvasTabs.addEventListener('click', syncAboutInfoOnNextFrame);
    canvasTabs.addEventListener('focusout', syncAboutInfoOnNextFrame);
  }

  document.getElementById('projectNameText')?.addEventListener('input', syncAboutInfo);
};

export function initAboutSettings() {
  syncAboutInfo();
  bindExternalLink();
  bindRefreshTriggers();
}