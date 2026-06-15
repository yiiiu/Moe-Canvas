import test from 'node:test';
import assert from 'node:assert/strict';

import { __test__, matchesTaskCenterUiFilters, resolveTaskUiType } from './unifiedTaskCenterUiEnhancements.js';

function createClassList(initial = '') {
  const values = new Set(String(initial).split(/\s+/).filter(Boolean));
  return {
    add(...items) {
      items.filter(Boolean).forEach((item) => values.add(item));
    },
    remove(...items) {
      items.forEach((item) => values.delete(item));
    },
    contains(item) {
      return values.has(item);
    },
    toString() {
      return Array.from(values).join(' ');
    },
  };
}

function createElement({ className = '', taskId = '' } = {}) {
  const children = [];
  const element = {
    className,
    classList: createClassList(className),
    dataset: taskId ? { taskId } : {},
    style: {},
    attributes: {},
    children,
    appendChild(child) {
      children.push(child);
      child.parentNode = element;
      return child;
    },
    insertBefore(child, reference) {
      const index = children.indexOf(reference);
      if (index === -1) return element.appendChild(child);
      children.splice(index, 0, child);
      child.parentNode = element;
      return child;
    },
    prepend(child) {
      children.unshift(child);
      child.parentNode = element;
      return child;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete element.attributes[name];
    },
    querySelector(selector) {
      return element.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const matches = (node) => {
        if (selector === '.v2-task-card[data-task-id]') return node.classList?.contains('v2-task-card') && Boolean(node.dataset?.taskId);
        if (selector === '.v2-task-card-main') return node.classList?.contains('v2-task-card-main');
        if (selector === '.v2-task-card-title') return node.classList?.contains('v2-task-card-title');
        if (selector === '.v2-task-center-action') return node.classList?.contains('v2-task-center-action');
        if (selector === '.v2-task-type-badge') return node.classList?.contains('v2-task-type-badge');
        if (selector === '.v2-task-progress') return node.classList?.contains('v2-task-progress');
        if (selector === '.v2-task-progress-fill') return node.classList?.contains('v2-task-progress-fill');
        return false;
      };
      const visit = (node) => {
        if (matches(node)) results.push(node);
        node.children?.forEach(visit);
      };
      children.forEach(visit);
      return results;
    },
  };
  return element;
}

function createTaskCard(taskId) {
  const card = createElement({ className: 'v2-task-card', taskId });
  const progress = createElement({ className: 'v2-task-progress' });
  const fill = createElement({ className: 'v2-task-progress-fill' });
  fill.style.width = '0%';
  progress.appendChild(fill);
  card.appendChild(progress);
  return { card, progress, fill };
}

function createTaskCardWithHeader(taskId) {
  const card = createElement({ className: 'v2-task-card', taskId });
  const header = createElement({ className: 'v2-task-card-header' });
  const main = createElement({ className: 'v2-task-card-main' });
  const title = createElement({ className: 'v2-task-card-title' });
  title.textContent = '媒体任务';
  main.appendChild(title);
  header.appendChild(main);
  card.appendChild(header);
  return { card, header, main, title };
}

test('task center resolves text tasks as text type for filtering', () => {
  const task = { taskId: 'generation:text-node-1:runtime-text-1', kind: 'text-generation', status: 'processing' };

  assert.equal(resolveTaskUiType(task), 'text');
  assert.equal(matchesTaskCenterUiFilters(task, { status: 'all', type: 'text' }), true);
  assert.equal(matchesTaskCenterUiFilters(task, { status: 'all', type: 'media' }), false);
});

test('task center card shows visible generation type badge', () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return createElement();
    },
  };

  try {
    const listEl = createElement();
    const { card } = createTaskCardWithHeader('task-1');
    listEl.appendChild(card);
    const manager = {
      listEl,
      tasks: new Map([
        ['task-1', { taskId: 'task-1', kind: 'text-generation', status: 'processing' }],
      ]),
    };

    __test__.syncTaskTypeBadges(manager);

    const badge = card.querySelector('.v2-task-type-badge');
    assert.ok(badge);
    assert.equal(badge.textContent, '文字');
    assert.equal(badge.dataset.taskType, 'text');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('task center cleanup action is shortened and marked as prominent', () => {
  const panel = createElement();
  const clearButton = createElement({ className: 'v2-task-center-action' });
  clearButton.textContent = '清理完成';
  panel.appendChild(clearButton);

  __test__.syncTaskCenterHeaderActions({ panel });

  assert.equal(clearButton.textContent, '清理');
  assert.equal(clearButton.classList.contains('v2-task-center-action--clear'), true);
  assert.equal(clearButton.classList.contains('v2-task-center-action--danger'), true);
});

test('task center active task shows indeterminate progress bar without percent text', () => {
  const listEl = createElement();
  const { card, progress, fill } = createTaskCard('task-1');
  listEl.appendChild(card);
  const manager = {
    listEl,
    tasks: new Map([
      ['task-1', { taskId: 'task-1', status: 'processing', progress: 0 }],
    ]),
  };

  __test__.syncTaskProgressBars(manager);

  assert.equal(progress.classList.contains('v2-task-progress--indeterminate'), true);
  assert.equal(fill.style.width, '');
  assert.equal(progress.attributes.role, 'progressbar');
  assert.equal(progress.attributes['aria-busy'], 'true');
  assert.equal(Object.hasOwn(progress.attributes, 'aria-valuenow'), false);
  assert.equal(progress.textContent || '', '');
  assert.equal(fill.textContent || '', '');
});

test('task center restores missing progress fill so active progress is visible', () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return createElement();
    },
  };

  try {
    const listEl = createElement();
    const card = createElement({ className: 'v2-task-card', taskId: 'task-1' });
    const progress = createElement({ className: 'v2-task-progress' });
    card.appendChild(progress);
    listEl.appendChild(card);
    const manager = {
      listEl,
      tasks: new Map([
        ['task-1', { taskId: 'task-1', status: 'processing', progress: 0 }],
      ]),
    };

    __test__.syncTaskProgressBars(manager);

    const fill = progress.querySelector('.v2-task-progress-fill');
    assert.ok(fill);
    assert.equal(progress.classList.contains('v2-task-progress--indeterminate'), true);
    assert.equal(fill.style.width, '');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('task center keeps determinate progress bar when progress is available', () => {
  const listEl = createElement();
  const { progress, fill, card } = createTaskCard('task-1');
  listEl.appendChild(card);
  const manager = {
    listEl,
    tasks: new Map([
      ['task-1', { taskId: 'task-1', status: 'processing', progress: 0.42 }],
    ]),
  };

  __test__.syncTaskProgressBars(manager);

  assert.equal(progress.classList.contains('v2-task-progress--indeterminate'), false);
  assert.equal(fill.style.width, '42%');
  assert.equal(progress.attributes['aria-valuenow'], '42');
  assert.equal(progress.textContent || '', '');
  assert.equal(fill.textContent || '', '');
});
