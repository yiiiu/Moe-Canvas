import { toolbarIconNodes } from './lucideToolbarIcons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvg(size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

function applyIconNodes(svg, nodes) {
  nodes.forEach(([tag, attrs]) => {
    const child = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => child.setAttribute(key, String(value)));
    svg.appendChild(child);
  });
  return svg;
}

function createIcon(name, size) {
  const iconNode = toolbarIconNodes[name];
  if (!Array.isArray(iconNode)) return null;
  return applyIconNodes(createSvg(size), iconNode);
}

function renderIcon(target) {
  const icon = createIcon(target.dataset.icon, Number(target.dataset.iconSize || 18));
  if (!icon) return;
  target.replaceChildren(icon);
}

export function renderIconLibrary(root = document) {
  root.querySelectorAll('[data-icon]').forEach((target) => {
    renderIcon(target);
  });
}