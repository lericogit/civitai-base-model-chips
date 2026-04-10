// ==UserScript==
// @name         Civitai Base Model Presets
// @namespace    https://github.com/lericogit/
// @version      1.0.0
// @author       lericogit
// @description  Replaces the Base model dropdown with preset chips on the Civitai models page.
// @license      MIT
// @homepageURL  https://github.com/lericogit/civitai-base-model-chips
// @supportURL   https://github.com/lericogit/civitai-base-model-chips/issues
// @match        https://civitai.com/*
// @match        https://civitai.red/*
// @match        https://civitai.green/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_KEY = 'tm-civitai-base-model-presets';
  const STYLE_ID = `${SCRIPT_KEY}-style`;
  const MODELS_PATH_PATTERN = /^\/models(?:\/|$)/i;
  const STORAGE_KEY = `${SCRIPT_KEY}:v1`;
  const STORAGE_VERSION = 1;

  const WRAPPER_ATTR = 'data-tm-base-model-presets';
  const PRESET_GROUP_ATTR = 'data-tm-base-model-preset-group';
  const EDITOR_ATTR = 'data-tm-base-model-preset-editor';
  const ACTIONS_ATTR = 'data-tm-base-model-preset-actions';
  const ACTION_BUTTON_ATTR = 'data-tm-base-model-preset-action-button';
  const ACTION_WARNING_ATTR = 'data-tm-base-model-preset-warning';
  const ACTION_LABEL_ATTR = 'data-tm-base-model-preset-action-label';
  const SIGNATURE_ATTR = 'data-tm-base-model-preset-signature';
  const HIDDEN_ATTR = 'data-tm-base-model-preset-hidden';
  const TOOLTIP_ATTR = 'data-tm-base-model-preset-tooltip';
  const TOOLTIP_TITLE_ATTR = 'data-tm-base-model-preset-tooltip-title';
  const TOOLTIP_BODY_ATTR = 'data-tm-base-model-preset-tooltip-body';

  const BUILTIN_ALL_PRESET_ID = '__all_models__';

  let chipIdCounter = 0;
  let syncQueued = false;
  let modelsPageObserver = null;
  let editorState = null;

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeKey(text) {
    return normalizeText(text).toLowerCase();
  }

  function uniqueNormalizedValues(values) {
    const seen = new Set();
    const normalizedValues = [];

    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeText(typeof value === 'string' ? value : '');
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      normalizedValues.push(normalized);
    }

    return normalizedValues;
  }

  function sanitizePresetName(value) {
    return normalizeText(typeof value === 'string' ? value : '');
  }

  function defaultStore() {
    return {
      version: STORAGE_VERSION,
      activePresetId: null,
      appliedModels: null,
      presets: [],
    };
  }

  function generatePresetId(existingIds) {
    let identifier = '';

    do {
      identifier = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } while (existingIds.has(identifier));

    return identifier;
  }

  function normalizeStore(rawStore) {
    const existingIds = new Set();
    const existingNames = new Set();
    const normalizedPresets = [];

    for (const rawPreset of Array.isArray(rawStore?.presets) ? rawStore.presets : []) {
      const name = sanitizePresetName(rawPreset?.name);
      const nameKey = normalizeKey(name);
      const rawId = normalizeText(typeof rawPreset?.id === 'string' ? rawPreset.id : '');

      if (!name || !nameKey || !rawId || existingIds.has(rawId) || existingNames.has(nameKey)) {
        continue;
      }

      existingIds.add(rawId);
      existingNames.add(nameKey);

      const createdAt = Number.isFinite(rawPreset?.createdAt) ? rawPreset.createdAt : Date.now();
      const updatedAt = Number.isFinite(rawPreset?.updatedAt) ? rawPreset.updatedAt : createdAt;

      normalizedPresets.push({
        id: rawId,
        name,
        models: uniqueNormalizedValues(rawPreset?.models),
        createdAt,
        updatedAt,
      });
    }

    const activePresetId = typeof rawStore?.activePresetId === 'string'
      && normalizedPresets.some((preset) => preset.id === rawStore.activePresetId)
      ? rawStore.activePresetId
      : null;

    const hasAppliedModels = Array.isArray(rawStore?.appliedModels);
    const normalizedAppliedModels = hasAppliedModels
      ? uniqueNormalizedValues(rawStore.appliedModels)
      : null;
    const fallbackAppliedModels = activePresetId
      ? uniqueNormalizedValues(normalizedPresets.find((preset) => preset.id === activePresetId)?.models)
      : null;

    return {
      version: STORAGE_VERSION,
      activePresetId,
      appliedModels: hasAppliedModels ? normalizedAppliedModels : fallbackAppliedModels,
      presets: normalizedPresets,
    };
  }

  function readStore() {
    try {
      const rawValue = localStorage.getItem(STORAGE_KEY);
      if (!rawValue) {
        return defaultStore();
      }

      return normalizeStore(JSON.parse(rawValue));
    } catch (error) {
      console.error(`${SCRIPT_KEY}: failed to read presets from localStorage`, error);
      return defaultStore();
    }
  }

  function writeStore(store) {
    const normalized = normalizeStore(store);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function parseTrpcInput(urlObject) {
    const input = urlObject.searchParams.get('input');
    if (!input) {
      return null;
    }

    try {
      return JSON.parse(input);
    } catch (error) {
      console.error(`${SCRIPT_KEY}: failed to parse tRPC input`, error);
      return null;
    }
  }

  function rewriteModelGetAllRequestUrl(urlValue) {
    try {
      const url = new URL(urlValue, window.location.origin);
      if (!url.pathname.includes('/api/trpc/model.getAll')) {
        return typeof urlValue === 'string' ? urlValue : url.toString();
      }

      const parsedInput = parseTrpcInput(url);
      if (!parsedInput?.json || typeof parsedInput.json !== 'object') {
        return typeof urlValue === 'string' ? urlValue : url.toString();
      }

      const store = readStore();
      if (!hasAppliedModelOverride(store)) {
        return typeof urlValue === 'string' ? urlValue : url.toString();
      }

      const appliedModels = getAppliedBaseModels(store);

      if (appliedModels.length) {
        parsedInput.json.baseModels = [...appliedModels];
      } else {
        delete parsedInput.json.baseModels;
      }

      url.searchParams.set('input', JSON.stringify(parsedInput));
      return typeof urlValue === 'string' ? url.toString() : url;
    } catch (error) {
      console.error(`${SCRIPT_KEY}: failed to rewrite model.getAll request`, error);
      return urlValue;
    }
  }

  function installRequestInterceptors() {
    if (typeof window.fetch === 'function' && !window.fetch.__tmBaseModelPresetsWrapped) {
      const originalFetch = window.fetch;
      const wrappedFetch = function (input, init) {
        if (typeof input === 'string') {
          return originalFetch.call(this, rewriteModelGetAllRequestUrl(input), init);
        }

        if (input instanceof Request) {
          const rewrittenUrl = rewriteModelGetAllRequestUrl(input.url);
          if (rewrittenUrl !== input.url) {
            try {
              return originalFetch.call(this, new Request(rewrittenUrl, input), init);
            } catch (error) {
              console.error(`${SCRIPT_KEY}: failed to clone rewritten fetch request`, error);
            }
          }
        }

        return originalFetch.call(this, input, init);
      };

      wrappedFetch.__tmBaseModelPresetsWrapped = true;
      window.fetch = wrappedFetch;
    }

    if (typeof XMLHttpRequest !== 'undefined' && !XMLHttpRequest.prototype.open.__tmBaseModelPresetsWrapped) {
      const originalOpen = XMLHttpRequest.prototype.open;
      const wrappedOpen = function (method, url, async, username, password) {
        const rewrittenUrl = typeof url === 'string' ? rewriteModelGetAllRequestUrl(url) : url;
        return originalOpen.call(this, method, rewrittenUrl, async, username, password);
      };

      wrappedOpen.__tmBaseModelPresetsWrapped = true;
      XMLHttpRequest.prototype.open = wrappedOpen;
    }
  }

  function getPresetById(store, presetId) {
    return store.presets.find((preset) => preset.id === presetId) || null;
  }

  function getActivePreset(store) {
    return getPresetById(store, store.activePresetId);
  }

  function hasAppliedModelOverride(store) {
    return Array.isArray(store?.appliedModels);
  }

  function getAppliedBaseModels(store) {
    if (hasAppliedModelOverride(store)) {
      return uniqueNormalizedValues(store.appliedModels);
    }

    return [];
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${WRAPPER_ATTR}="true"] {
        width: 100%;
      }

      [${ACTIONS_ATTR}="true"] {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: calc(0.35rem * var(--mantine-scale, 1));
        flex-wrap: wrap;
        max-width: min(80vw, 42rem);
        z-index: 1;
      }

      [data-tm-base-model-preset-divider="true"] {
        position: relative;
        padding-right: var(--tm-base-model-preset-actions-space, calc(10rem * var(--mantine-scale, 1)));
      }

      [${ACTION_BUTTON_ATTR}="true"] {
        appearance: none;
        background: var(--mantine-color-body, rgba(255, 255, 255, 0.95));
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid var(--mantine-color-default-border, rgba(0, 0, 0, 0.18));
        border-radius: 999px;
        color: var(--mantine-color-dimmed, inherit);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: calc(0.25rem * var(--mantine-scale, 1));
        font: inherit;
        font-size: var(--mantine-font-size-xs, 0.75rem);
        line-height: 1.2;
        padding: calc(0.2rem * var(--mantine-scale, 1)) calc(0.55rem * var(--mantine-scale, 1));
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
      }

      [${ACTION_BUTTON_ATTR}="true"]:hover {
        background: var(--mantine-color-default-hover, rgba(0, 0, 0, 0.05));
      }

      [${ACTION_BUTTON_ATTR}="true"][data-variant="primary"] {
        color: var(--mantine-color-blue-filled, #228be6);
        border-color: rgba(34, 139, 230, 0.35);
      }

      [${ACTION_BUTTON_ATTR}="true"][data-variant="danger"] {
        color: var(--mantine-color-red-7, #c92a2a);
        border-color: rgba(250, 82, 82, 0.35);
      }

      [${ACTION_BUTTON_ATTR}="true"]:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      [${ACTION_WARNING_ATTR}="true"] {
        display: none;
        align-items: center;
        color: #8f5b00;
        background: rgba(255, 212, 59, 0.14);
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid #f59f00;
        border-radius: 999px;
        font-size: var(--mantine-font-size-xs, 0.75rem);
        line-height: 1.2;
        padding: calc(0.18rem * var(--mantine-scale, 1)) calc(0.5rem * var(--mantine-scale, 1));
        white-space: nowrap;
      }

      [${ACTION_WARNING_ATTR}="true"][data-visible="true"] {
        display: inline-flex;
      }

      [${EDITOR_ATTR}="true"] {
        margin-top: calc(0.75rem * var(--mantine-scale, 1));
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid var(--mantine-color-default-border, rgba(0, 0, 0, 0.18));
        border-radius: var(--mantine-radius-md, 0.5rem);
        background: var(--mantine-color-body, rgba(255, 255, 255, 0.98));
        padding: calc(0.75rem * var(--mantine-scale, 1));
      }

      [${EDITOR_ATTR}="true"][data-disabled="true"] {
        opacity: 0.7;
      }

      [data-tm-base-model-preset-editor-top="true"] {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(0.5rem * var(--mantine-scale, 1));
        margin-bottom: calc(0.65rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-editor-title="true"] {
        font-size: var(--mantine-font-size-sm, 0.875rem);
        font-weight: 600;
      }

      [data-tm-base-model-preset-selected-count="true"] {
        color: var(--mantine-color-dimmed, rgba(0, 0, 0, 0.65));
        font-size: var(--mantine-font-size-xs, 0.75rem);
      }

      [data-tm-base-model-preset-field="true"] {
        display: flex;
        flex-direction: column;
        gap: calc(0.35rem * var(--mantine-scale, 1));
        margin-bottom: calc(0.75rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-field-label="true"] {
        color: var(--mantine-color-dimmed, rgba(0, 0, 0, 0.65));
        font-size: var(--mantine-font-size-xs, 0.75rem);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      [data-tm-base-model-preset-input="true"] {
        appearance: none;
        width: 100%;
        background: var(--mantine-color-body, #fff);
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid var(--mantine-color-default-border, rgba(0, 0, 0, 0.18));
        border-radius: var(--mantine-radius-sm, 0.375rem);
        color: inherit;
        font: inherit;
        line-height: 1.4;
        padding: calc(0.45rem * var(--mantine-scale, 1)) calc(0.65rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-messages="true"] {
        display: flex;
        flex-direction: column;
        gap: calc(0.35rem * var(--mantine-scale, 1));
        margin-bottom: calc(0.75rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-message="true"] {
        border-radius: var(--mantine-radius-sm, 0.375rem);
        font-size: var(--mantine-font-size-xs, 0.75rem);
        line-height: 1.35;
        padding: calc(0.45rem * var(--mantine-scale, 1)) calc(0.55rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-message="true"][data-tone="error"] {
        color: var(--mantine-color-red-7, #c92a2a);
        background: rgba(250, 82, 82, 0.08);
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid rgba(250, 82, 82, 0.24);
      }

      [data-tm-base-model-preset-message="true"][data-tone="warning"] {
        color: #8f5b00;
        background: rgba(255, 212, 59, 0.14);
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid rgba(245, 159, 0, 0.34);
      }

      [data-tm-base-model-preset-editor-actions="true"] {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: calc(0.5rem * var(--mantine-scale, 1));
        margin-top: calc(0.8rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-editor-button="true"] {
        appearance: none;
        background: var(--mantine-color-body, rgba(255, 255, 255, 0.95));
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid var(--mantine-color-default-border, rgba(0, 0, 0, 0.18));
        border-radius: var(--mantine-radius-sm, 0.375rem);
        color: inherit;
        cursor: pointer;
        font: inherit;
        font-size: var(--mantine-font-size-sm, 0.875rem);
        line-height: 1.2;
        padding: calc(0.45rem * var(--mantine-scale, 1)) calc(0.75rem * var(--mantine-scale, 1));
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
      }

      [data-tm-base-model-preset-editor-button="true"]:not(:disabled):hover {
        background: var(--mantine-color-default-hover, rgba(0, 0, 0, 0.05));
      }

      [data-tm-base-model-preset-editor-button="true"]:not(:disabled):focus-visible {
        outline: none;
        box-shadow: 0 0 0 calc(0.125rem * var(--mantine-scale, 1)) rgba(34, 139, 230, 0.18);
      }

      [data-tm-base-model-preset-editor-button="true"][data-variant="primary"] {
        color: var(--mantine-color-blue-filled, #228be6);
        border-color: rgba(34, 139, 230, 0.35);
      }

      [data-tm-base-model-preset-editor-button="true"][data-variant="primary"]:not(:disabled):hover {
        background: rgba(34, 139, 230, 0.08);
        border-color: rgba(34, 139, 230, 0.48);
      }

      [data-tm-base-model-preset-editor-button="true"][data-variant="danger"] {
        color: var(--mantine-color-red-7, #c92a2a);
        border-color: rgba(250, 82, 82, 0.35);
      }

      [data-tm-base-model-preset-editor-button="true"][data-variant="danger"]:not(:disabled):hover {
        background: rgba(250, 82, 82, 0.08);
        border-color: rgba(250, 82, 82, 0.48);
      }

      [data-tm-base-model-preset-editor-button="true"]:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      [${TOOLTIP_ATTR}="true"] {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 500;
        min-width: 15rem;
        max-width: min(26rem, calc(100vw - 24px));
        display: none;
        flex-direction: column;
        gap: calc(0.4rem * var(--mantine-scale, 1));
        padding: calc(0.65rem * var(--mantine-scale, 1)) calc(0.75rem * var(--mantine-scale, 1));
        border: calc(0.0625rem * var(--mantine-scale, 1)) solid rgba(255, 255, 255, 0.09);
        border-radius: calc(0.6rem * var(--mantine-scale, 1));
        background:
          linear-gradient(180deg, rgba(28, 30, 36, 0.98), rgba(18, 20, 24, 0.98));
        box-shadow:
          0 12px 30px rgba(0, 0, 0, 0.34),
          0 2px 10px rgba(0, 0, 0, 0.18);
        color: rgba(245, 247, 250, 0.96);
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 110ms ease, transform 110ms ease;
      }

      [${TOOLTIP_ATTR}="true"][data-visible="true"] {
        display: flex;
        opacity: 1;
        transform: translateY(0);
      }

      [${TOOLTIP_TITLE_ATTR}="true"] {
        font-size: var(--mantine-font-size-sm, 0.875rem);
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 0.01em;
      }

      [${TOOLTIP_BODY_ATTR}="true"] {
        display: flex;
        flex-direction: column;
        gap: calc(0.28rem * var(--mantine-scale, 1));
      }

      [data-tm-base-model-preset-tooltip-row="true"] {
        display: flex;
        align-items: flex-start;
        gap: calc(0.45rem * var(--mantine-scale, 1));
        color: rgba(226, 231, 238, 0.92);
        font-size: var(--mantine-font-size-xs, 0.75rem);
        line-height: 1.35;
      }

      [data-tm-base-model-preset-tooltip-bullet="true"] {
        color: rgba(99, 198, 255, 0.95);
        font-weight: 700;
        line-height: 1.2;
        flex: 0 0 auto;
        margin-top: 1px;
      }

    `;

    document.head.appendChild(style);
  }

  function hideElement(element) {
    if (!element) {
      return;
    }

    element.hidden = true;
    element.setAttribute(HIDDEN_ATTR, 'true');
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.style.setProperty('opacity', '0', 'important');
    element.style.setProperty('pointer-events', 'none', 'important');
  }

  function scheduleSync() {
    if (syncQueued) {
      return;
    }

    syncQueued = true;

    window.requestAnimationFrame(() => {
      syncQueued = false;
      syncAllSections();
    });
  }

  function isModelsPage() {
    return MODELS_PATH_PATTERN.test(window.location.pathname);
  }

  function getBaseModelSections() {
    return [...document.querySelectorAll('.mantine-Divider-label')]
      .filter((label) => {
        const text = normalizeKey(label.textContent);
        return text === 'base model' || text === 'base model presets';
      })
      .map((label) => label.closest('.mantine-Stack-root'))
      .filter(Boolean);
  }

  function getMultiSelectRoot(section) {
    return section.querySelector('.mantine-MultiSelect-root');
  }

  function renameSectionLabel(section) {
    const label = section.querySelector('.mantine-Divider-label');
    if (!label) {
      return;
    }

    if (normalizeKey(label.textContent) === 'base model') {
      label.textContent = 'Base model presets';
    }
  }

  function buildOptionsFromNodes(nodes) {
    const seen = new Set();
    const options = [];

    for (const node of nodes) {
      const value = normalizeText(node.getAttribute('value') || node.textContent);
      if (!value || seen.has(value)) {
        continue;
      }

      seen.add(value);

      const spans = node.querySelectorAll('span');
      const labelNode = spans[spans.length - 1];
      const label = normalizeText(labelNode ? labelNode.textContent : value);

      options.push({ value, label });
    }

    return options;
  }

  function getSelectedValuesFromHiddenInput(section) {
    const hiddenInput = section.querySelector('.mantine-MultiSelect-root input[type="hidden"]');
    if (!hiddenInput) {
      return [];
    }

    return hiddenInput.value
      .split(',')
      .map((value) => normalizeText(value))
      .filter(Boolean);
  }

  function getLiveOptionNodes(section) {
    const scopedNodes = [...section.querySelectorAll('.mantine-MultiSelect-option[data-combobox-option]')];
    if (scopedNodes.length) {
      return scopedNodes;
    }

    const selectedKeys = new Set(
      getSelectedValuesFromHiddenInput(section)
        .map((value) => normalizeKey(value))
        .filter(Boolean)
    );
    const dropdowns = [...document.querySelectorAll('.mantine-MultiSelect-dropdown')];
    const candidates = [];
    let bestNodes = [];
    let bestScore = 0;
    let largestNodes = [];

    for (const dropdown of dropdowns) {
      const nodes = [...dropdown.querySelectorAll('.mantine-MultiSelect-option[data-combobox-option]')];
      if (!nodes.length) {
        continue;
      }

      candidates.push(nodes);

      const score = nodes.reduce((total, node) => {
        const value = normalizeKey(node.getAttribute('value') || node.textContent);
        return total + (selectedKeys.has(value) ? 1 : 0);
      }, 0);

      if (score > bestScore || (score === bestScore && score > 0 && nodes.length > bestNodes.length)) {
        bestNodes = nodes;
        bestScore = score;
      }

      if (nodes.length > largestNodes.length) {
        largestNodes = nodes;
      }
    }

    if (bestScore > 0) {
      return bestNodes;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    return largestNodes;
  }

  function getLiveOptions(section) {
    return buildOptionsFromNodes(getLiveOptionNodes(section));
  }

  function getSelectedValues(section) {
    const hiddenValues = getSelectedValuesFromHiddenInput(section);
    if (hiddenValues.length) {
      return hiddenValues;
    }

    return getLiveOptionNodes(section)
      .filter((node) => node.getAttribute('aria-selected') === 'true')
      .map((node) => normalizeText(node.getAttribute('value') || node.textContent))
      .filter(Boolean);
  }

  function getGroupTemplate() {
    const existingGroup = [...document.querySelectorAll('.mantine-Group-root')]
      .find((group) => group.querySelector('.mantine-Chip-root') && !group.closest(`[${WRAPPER_ATTR}]`));

    if (existingGroup) {
      const clone = existingGroup.cloneNode(false);
      clone.removeAttribute('id');
      return clone;
    }

    const fallback = document.createElement('div');
    fallback.style.display = 'flex';
    fallback.style.flexWrap = 'wrap';
    fallback.style.alignItems = 'center';
    fallback.style.justifyContent = 'flex-start';
    fallback.style.gap = 'calc(0.5rem * var(--mantine-scale, 1))';
    return fallback;
  }

  function getChipTemplates() {
    const chips = [...document.querySelectorAll('.mantine-Chip-root')]
      .filter((chip) => !chip.closest(`[${WRAPPER_ATTR}]`));

    const unchecked = chips.find((chip) => !chip.querySelector('input')?.checked) || chips[0];
    const checked = chips.find((chip) => chip.querySelector('input')?.checked) || unchecked;

    return { unchecked, checked };
  }

  function ensureTooltipElement() {
    let tooltip = document.querySelector(`[${TOOLTIP_ATTR}="true"]`);
    if (tooltip) {
      return tooltip;
    }

    tooltip = document.createElement('div');
    tooltip.setAttribute(TOOLTIP_ATTR, 'true');
    tooltip.dataset.visible = 'false';

    const title = document.createElement('div');
    title.setAttribute(TOOLTIP_TITLE_ATTR, 'true');

    const body = document.createElement('div');
    body.setAttribute(TOOLTIP_BODY_ATTR, 'true');

    tooltip.append(title, body);
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function hideTooltip() {
    const tooltip = document.querySelector(`[${TOOLTIP_ATTR}="true"]`);
    if (!tooltip) {
      return;
    }

    tooltip.dataset.visible = 'false';
  }

  function positionTooltip(tooltip, target) {
    if (!tooltip || !target) {
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 12;

    let top = targetRect.bottom + 10;
    let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

    if (left < margin) {
      left = margin;
    }

    if (left + tooltipRect.width > window.innerWidth - margin) {
      left = window.innerWidth - tooltipRect.width - margin;
    }

    if (top + tooltipRect.height > window.innerHeight - margin) {
      top = targetRect.top - tooltipRect.height - 10;
    }

    if (top < margin) {
      top = margin;
    }

    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.left = `${Math.round(left)}px`;
  }

  function showTooltip(target, titleText, rows) {
    if (!target || !titleText || !Array.isArray(rows) || !rows.length) {
      hideTooltip();
      return;
    }

    const tooltip = ensureTooltipElement();
    const title = tooltip.querySelector(`[${TOOLTIP_TITLE_ATTR}="true"]`);
    const body = tooltip.querySelector(`[${TOOLTIP_BODY_ATTR}="true"]`);

    if (!title || !body) {
      return;
    }

    title.textContent = titleText;

    const fragment = document.createDocumentFragment();
    for (const rowText of rows) {
      const row = document.createElement('div');
      row.setAttribute('data-tm-base-model-preset-tooltip-row', 'true');

      const bullet = document.createElement('span');
      bullet.setAttribute('data-tm-base-model-preset-tooltip-bullet', 'true');
      bullet.textContent = '•';

      const text = document.createElement('span');
      text.textContent = rowText;

      row.append(bullet, text);
      fragment.appendChild(row);
    }

    body.replaceChildren(fragment);
    tooltip.dataset.visible = 'true';
    tooltip.style.top = '0px';
    tooltip.style.left = '0px';
    positionTooltip(tooltip, target);
  }

  function attachChipTooltip(chip, titleText, rows) {
    if (!chip || !titleText || !Array.isArray(rows) || !rows.length) {
      return;
    }

    chip.addEventListener('mouseenter', () => {
      showTooltip(chip, titleText, rows);
    });

    chip.addEventListener('mouseleave', () => {
      hideTooltip();
    });

    chip.addEventListener('focusin', () => {
      showTooltip(chip, titleText, rows);
    });

    chip.addEventListener('focusout', () => {
      hideTooltip();
    });
  }

  function buildLabelContent(templateLabel, text) {
    const icon = templateLabel.querySelector('.mantine-Chip-iconWrapper');
    const outer = document.createElement('span');
    const inner = document.createElement('span');

    inner.textContent = text;
    outer.appendChild(inner);

    return icon ? [icon.cloneNode(true), outer] : [outer];
  }

  function createTemplateChip(templates, value, labelText, selected, onClick, disabled, tooltipRows) {
    const source = selected ? (templates.checked || templates.unchecked) : templates.unchecked;
    if (!source) {
      return null;
    }

    const chip = source.cloneNode(true);
    const input = chip.querySelector('input');
    const label = chip.querySelector('label');

    if (!input || !label) {
      return null;
    }

    chipIdCounter += 1;

    input.id = `${SCRIPT_KEY}-${chipIdCounter}`;
    input.type = 'checkbox';
    input.value = value;
    input.checked = selected;
    input.name = '';
    input.disabled = Boolean(disabled);

    if (selected) {
      input.setAttribute('checked', '');
      label.setAttribute('data-checked', 'true');
    } else {
      input.removeAttribute('checked');
      label.removeAttribute('data-checked');
    }

    label.htmlFor = input.id;
    label.replaceChildren(...buildLabelContent(label, labelText));

    if (disabled) {
      chip.style.opacity = '0.6';
      chip.style.pointerEvents = 'none';
      return chip;
    }

    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });

    attachChipTooltip(chip, labelText, tooltipRows);

    return chip;
  }

  function getOrCreateWrapper(section) {
    let wrapper = section.querySelector(`[${WRAPPER_ATTR}="true"]`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.setAttribute(WRAPPER_ATTR, 'true');

      const group = getGroupTemplate();
      group.setAttribute(PRESET_GROUP_ATTR, 'true');
      wrapper.appendChild(group);

      const multiSelectRoot = getMultiSelectRoot(section);
      if (multiSelectRoot) {
        multiSelectRoot.insertAdjacentElement('afterend', wrapper);
      } else {
        section.appendChild(wrapper);
      }
    }

    return wrapper;
  }

  function getEffectivePresetModels(preset, liveOptions) {
    const liveValues = new Set(liveOptions.map((option) => option.value));
    return uniqueNormalizedValues(preset?.models).filter((value) => liveValues.has(value));
  }

  function getMissingPresetModels(preset, liveOptions) {
    const liveValues = new Set(liveOptions.map((option) => option.value));
    return uniqueNormalizedValues(preset?.models).filter((value) => !liveValues.has(value));
  }

  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }

    return true;
  }

  function getComparableModelSet(values) {
    return uniqueNormalizedValues(values).sort((left, right) => left.localeCompare(right));
  }

  function syncActionLayout(section) {
    const divider = section.querySelector('.mantine-Divider-root');
    const actions = divider?.querySelector(`[${ACTIONS_ATTR}="true"]`);
    if (!divider || !actions) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!divider.isConnected || !actions.isConnected) {
        return;
      }

      const spacing = Math.ceil(actions.getBoundingClientRect().width + 12);
      divider.style.setProperty('--tm-base-model-preset-actions-space', `${spacing}px`);
    });
  }

  function createActionButton(label, variant, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(ACTION_BUTTON_ATTR, 'true');
    button.setAttribute(ACTION_LABEL_ATTR, 'true');
    button.dataset.variant = variant;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function ensureActions(section) {
    const divider = section.querySelector('.mantine-Divider-root');
    if (!divider) {
      return null;
    }

    divider.setAttribute('data-tm-base-model-preset-divider', 'true');
    divider.style.setProperty('margin-bottom', 'calc(0.5rem * var(--mantine-scale, 1))', 'important');

    let actions = divider.querySelector(`[${ACTIONS_ATTR}="true"]`);
    if (actions) {
      return actions;
    }

    actions = document.createElement('div');
    actions.setAttribute(ACTIONS_ATTR, 'true');

    const warning = document.createElement('span');
    warning.setAttribute(ACTION_WARNING_ATTR, 'true');
    warning.dataset.visible = 'false';
    warning.textContent = 'Live list unavailable';

    const createButton = createActionButton('Create preset', 'primary', () => {
      openCreateEditor(section);
    });
    createButton.dataset.action = 'create';

    const editButton = createActionButton('Edit preset', 'default', () => {
      openActivePresetEditor(section);
    });
    editButton.dataset.action = 'edit';

    const deleteButton = createActionButton('Delete preset', 'danger', () => {
      deleteActivePreset(section);
    });
    deleteButton.dataset.action = 'delete';

    actions.append(warning, createButton, editButton, deleteButton);
    divider.appendChild(actions);
    return actions;
  }

  function updateActions(section, store, liveOptions) {
    const actions = ensureActions(section);
    if (!actions) {
      return;
    }

    const createButton = actions.querySelector('[data-action="create"]');
    const editButton = actions.querySelector('[data-action="edit"]');
    const deleteButton = actions.querySelector('[data-action="delete"]');
    const warning = actions.querySelector(`[${ACTION_WARNING_ATTR}="true"]`);
    const activePreset = getActivePreset(store);
    const liveAvailable = liveOptions.length > 0;

    if (createButton) {
      createButton.disabled = !liveAvailable;
      createButton.title = liveAvailable
        ? 'Create a new Base model preset'
        : 'Could not read the live Base model list right now';
    }

    if (editButton) {
      editButton.style.display = activePreset ? '' : 'none';
      editButton.disabled = !liveAvailable;
      editButton.title = liveAvailable
        ? 'Edit the active preset'
        : 'Could not read the live Base model list right now';
    }

    if (deleteButton) {
      deleteButton.style.display = activePreset ? '' : 'none';
      deleteButton.disabled = !liveAvailable;
      deleteButton.title = liveAvailable
        ? 'Delete the active preset'
        : 'Could not read the live Base model list right now';
    }

    if (warning) {
      warning.dataset.visible = liveAvailable ? 'false' : 'true';
      warning.title = liveAvailable
        ? ''
        : 'Could not read Civitai\'s live Base model list. Preset actions are temporarily disabled.';
    }

    syncActionLayout(section);
  }

  function getSignature(store, liveOptions, liveAvailable) {
    return JSON.stringify({
      activePresetId: store.activePresetId,
      appliedModels: hasAppliedModelOverride(store) ? getAppliedBaseModels(store) : null,
      presets: store.presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        models: uniqueNormalizedValues(preset.models),
      })),
      editor: editorState
        ? {
            mode: editorState.mode,
            presetId: editorState.presetId,
            name: editorState.name,
            models: uniqueNormalizedValues(editorState.models),
            error: editorState.error || '',
          }
        : null,
      liveAvailable,
      liveValues: liveOptions.map((option) => option.value),
    });
  }

  function setEditorState(nextState) {
    editorState = nextState;
    scheduleSync();
  }

  function openCreateEditor(section) {
    const liveOptions = getLiveOptions(section);
    if (!liveOptions.length) {
      return;
    }

    const store = readStore();
    const initialModels = store.activePresetId
      ? getAppliedBaseModels(store)
      : hasAppliedModelOverride(store)
        ? getAppliedBaseModels(store)
        : getSelectedValues(section);

    setEditorState({
      mode: 'create',
      presetId: null,
      name: '',
      models: initialModels,
      error: '',
    });
  }

  function openActivePresetEditor(section) {
    const store = readStore();
    const activePreset = getActivePreset(store);
    const liveOptions = getLiveOptions(section);
    if (!activePreset || !liveOptions.length) {
      return;
    }

    setEditorState({
      mode: 'edit',
      presetId: activePreset.id,
      name: activePreset.name,
      models: getEffectivePresetModels(activePreset, liveOptions),
      error: '',
    });
  }

  function closeEditor() {
    editorState = null;
    scheduleSync();
  }

  function toggleEditorModel(value) {
    if (!editorState) {
      return;
    }

    const currentModels = new Set(uniqueNormalizedValues(editorState.models));
    if (currentModels.has(value)) {
      currentModels.delete(value);
    } else {
      currentModels.add(value);
    }

    editorState = {
      ...editorState,
      models: [...currentModels],
      error: '',
    };

    scheduleSync();
  }

  function validateEditor(store) {
    if (!editorState) {
      return 'Preset editor is not open.';
    }

    const name = sanitizePresetName(editorState.name);
    if (!name) {
      return 'Preset name is required.';
    }

    if (uniqueNormalizedValues(editorState.models).length === 0) {
      return 'Select at least one Base model for this preset.';
    }

    const duplicateName = store.presets.find((preset) => {
      if (editorState.mode === 'edit' && preset.id === editorState.presetId) {
        return false;
      }

      return normalizeKey(preset.name) === normalizeKey(name);
    });

    if (duplicateName) {
      return 'Preset names must be unique.';
    }

    return '';
  }

  function saveEditor(section) {
    const liveOptions = getLiveOptions(section);
    if (!liveOptions.length || !editorState) {
      return;
    }

    const store = readStore();
    const shouldApplyAfterSave = editorState.mode === 'create' || store.activePresetId === editorState.presetId;
    const error = validateEditor(store);
    if (error) {
      editorState = {
        ...editorState,
        error,
      };
      scheduleSync();
      return;
    }

    const now = Date.now();
    const nextName = sanitizePresetName(editorState.name);
    const nextModels = uniqueNormalizedValues(editorState.models);
    let nextStore = store;

    if (editorState.mode === 'edit' && editorState.presetId) {
      nextStore = {
        ...store,
        presets: store.presets.map((preset) => {
          if (preset.id !== editorState.presetId) {
            return preset;
          }

          return {
            ...preset,
            name: nextName,
            models: nextModels,
            updatedAt: now,
          };
        }),
      };
    } else {
      const nextId = generatePresetId(new Set(store.presets.map((preset) => preset.id)));
      nextStore = {
        ...store,
        activePresetId: nextId,
        presets: [
          ...store.presets,
          {
            id: nextId,
            name: nextName,
            models: nextModels,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    }

    nextStore = writeStore(nextStore);
    const savedPreset = editorState.mode === 'edit'
      ? getPresetById(nextStore, editorState.presetId)
      : getActivePreset(nextStore);

    editorState = null;

    if (savedPreset && shouldApplyAfterSave) {
      const effectiveModels = getEffectivePresetModels(savedPreset, liveOptions);
      writeStore({
        ...nextStore,
        activePresetId: savedPreset.id,
        appliedModels: effectiveModels,
      });
      window.location.reload();
      return;
    }

    scheduleSync();
  }

  function confirmDeletePresetName(name) {
    return window.confirm(`Delete preset "${name}"?`);
  }

  function deletePreset(section, presetId) {
    const liveOptions = getLiveOptions(section);
    if (!liveOptions.length) {
      return;
    }

    const store = readStore();
    const preset = getPresetById(store, presetId);
    if (!preset || !confirmDeletePresetName(preset.name)) {
      return;
    }

    let nextStore = {
      ...store,
      presets: store.presets.filter((item) => item.id !== presetId),
      activePresetId: store.activePresetId === presetId ? null : store.activePresetId,
    };

    nextStore = writeStore(nextStore);

    if (editorState?.presetId === presetId) {
      editorState = null;
    }

    if (store.activePresetId === presetId) {
      writeStore({
        ...nextStore,
        activePresetId: null,
        appliedModels: [],
      });
      window.location.reload();
      return;
    }

    scheduleSync();
  }

  function deleteActivePreset(section) {
    const store = readStore();
    if (!store.activePresetId) {
      return;
    }

    deletePreset(section, store.activePresetId);
  }

  function selectAllModels(section) {
    const previousActivePresetId = readStore().activePresetId;
    writeStore({
      ...readStore(),
      activePresetId: null,
      appliedModels: [],
    });
    window.location.reload();

    if (editorState?.mode === 'edit' && editorState.presetId === previousActivePresetId) {
      editorState = null;
    }
  }

  function selectPreset(section, presetId) {
    const liveOptions = getLiveOptions(section);
    if (!liveOptions.length) {
      return;
    }

    const store = readStore();
    const preset = getPresetById(store, presetId);
    if (!preset) {
      return;
    }

    const effectiveModels = getEffectivePresetModels(preset, liveOptions);
    writeStore({
      ...store,
      activePresetId: preset.id,
      appliedModels: effectiveModels,
    });

    if (editorState?.mode === 'edit' && editorState.presetId !== preset.id) {
      editorState = null;
    }

    window.location.reload();
  }

  function renderPresetChips(section, wrapper, store, liveOptions) {
    const group = wrapper.querySelector(`[${PRESET_GROUP_ATTR}="true"]`);
    if (!group) {
      return;
    }

    const templates = getChipTemplates();
    if (!templates.unchecked) {
      return;
    }

    const liveAvailable = liveOptions.length > 0;
    const fragment = document.createDocumentFragment();

    const allModelsChip = createTemplateChip(
      templates,
      BUILTIN_ALL_PRESET_ID,
      'All models',
      !store.activePresetId,
      () => {
        selectAllModels(section);
      },
      !liveAvailable,
      ['Clears the Base model filter and shows all models.']
    );

    if (allModelsChip) {
      fragment.appendChild(allModelsChip);
    }

    for (const preset of store.presets) {
      const chip = createTemplateChip(
        templates,
        preset.id,
        preset.name,
        store.activePresetId === preset.id,
        () => {
          selectPreset(section, preset.id);
        },
        !liveAvailable,
        uniqueNormalizedValues(preset.models)
      );

      if (chip) {
        fragment.appendChild(chip);
      }
    }

    group.replaceChildren(fragment);
  }

  function createEditorButton(label, variant, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-tm-base-model-preset-editor-button', 'true');
    button.dataset.variant = variant;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  function renderEditor(section, wrapper, store, liveOptions) {
    const existingEditor = wrapper.querySelector(`[${EDITOR_ATTR}="true"]`);
    if (!editorState) {
      existingEditor?.remove();
      return;
    }

    const liveAvailable = liveOptions.length > 0;
    const preset = editorState.mode === 'edit' ? getPresetById(store, editorState.presetId) : null;
    const missingModels = preset ? getMissingPresetModels(preset, liveOptions) : [];
    const selectedModelSet = new Set(uniqueNormalizedValues(editorState.models));
    const templates = getChipTemplates();

    if (!templates.unchecked) {
      existingEditor?.remove();
      return;
    }

    const editor = existingEditor || document.createElement('div');
    editor.setAttribute(EDITOR_ATTR, 'true');
    editor.dataset.disabled = liveAvailable ? 'false' : 'true';

    const topRow = document.createElement('div');
    topRow.setAttribute('data-tm-base-model-preset-editor-top', 'true');

    const title = document.createElement('div');
    title.setAttribute('data-tm-base-model-preset-editor-title', 'true');
    title.textContent = editorState.mode === 'edit' ? 'Edit preset' : 'Create preset';

    const count = document.createElement('div');
    count.setAttribute('data-tm-base-model-preset-selected-count', 'true');
    count.textContent = `${selectedModelSet.size} selected`;

    topRow.append(title, count);

    const field = document.createElement('div');
    field.setAttribute('data-tm-base-model-preset-field', 'true');

    const fieldLabel = document.createElement('label');
    fieldLabel.setAttribute('data-tm-base-model-preset-field-label', 'true');
    fieldLabel.textContent = 'Preset name';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = editorState.name;
    input.placeholder = 'My preset';
    input.disabled = !liveAvailable;
    input.setAttribute('data-tm-base-model-preset-input', 'true');
    input.addEventListener('input', (event) => {
      editorState = {
        ...editorState,
        name: event.currentTarget.value,
        error: '',
      };
    });

    field.append(fieldLabel, input);

    const messages = document.createElement('div');
    messages.setAttribute('data-tm-base-model-preset-messages', 'true');

    if (!liveAvailable) {
      const warning = document.createElement('div');
      warning.setAttribute('data-tm-base-model-preset-message', 'true');
      warning.dataset.tone = 'warning';
      warning.textContent = 'Could not read Civitai\'s live Base model list. Preset editing is temporarily disabled.';
      messages.appendChild(warning);
    }

    if (missingModels.length) {
      const warning = document.createElement('div');
      warning.setAttribute('data-tm-base-model-preset-message', 'true');
      warning.dataset.tone = 'warning';
      warning.textContent = `This preset includes models that are no longer in Civitai's live list: ${missingModels.join(', ')}. Saving will drop them from the preset.`;
      messages.appendChild(warning);
    }

    if (editorState.error) {
      const error = document.createElement('div');
      error.setAttribute('data-tm-base-model-preset-message', 'true');
      error.dataset.tone = 'error';
      error.textContent = editorState.error;
      messages.appendChild(error);
    }

    const modelGroup = getGroupTemplate();
    modelGroup.setAttribute('data-tm-base-model-preset-editor-chip-group', 'true');

    const modelFragment = document.createDocumentFragment();
    for (const option of liveOptions) {
      const chip = createTemplateChip(
        templates,
        option.value,
        option.label,
        selectedModelSet.has(option.value),
        () => {
          toggleEditorModel(option.value);
        },
        !liveAvailable
      );

      if (chip) {
        modelFragment.appendChild(chip);
      }
    }

    modelGroup.appendChild(modelFragment);

    const actions = document.createElement('div');
    actions.setAttribute('data-tm-base-model-preset-editor-actions', 'true');

    if (editorState.mode === 'edit' && preset) {
      const deleteButton = createEditorButton('Delete', 'danger', () => {
        deletePreset(section, preset.id);
      });
      deleteButton.disabled = !liveAvailable;
      actions.appendChild(deleteButton);
    }

    const cancelButton = createEditorButton('Cancel', 'default', () => {
      closeEditor();
    });

    const saveButton = createEditorButton('Save preset', 'primary', () => {
      saveEditor(section);
    });
    saveButton.disabled = !liveAvailable;

    actions.append(cancelButton, saveButton);

    editor.replaceChildren(topRow, field);

    if (messages.childNodes.length) {
      editor.appendChild(messages);
    }

    editor.append(modelGroup, actions);

    if (!existingEditor) {
      wrapper.appendChild(editor);
    }
  }

  function syncSection(section) {
    const multiSelectRoot = getMultiSelectRoot(section);
    if (!multiSelectRoot) {
      return;
    }

    const liveOptions = getLiveOptions(section);
    let store = readStore();

    if (liveOptions.length && store.activePresetId) {
      const activePreset = getActivePreset(store);
      if (activePreset) {
        const effectiveModels = getEffectivePresetModels(activePreset, liveOptions);
        if (!arraysEqual(getComparableModelSet(getAppliedBaseModels(store)), getComparableModelSet(effectiveModels))) {
          store = writeStore({
            ...store,
            appliedModels: effectiveModels,
          });
        }
      }
    }

    hideElement(multiSelectRoot);
    hideElement(section.querySelector('.mantine-MultiSelect-dropdown'));
    renameSectionLabel(section);

    const wrapper = getOrCreateWrapper(section);
    const group = wrapper.querySelector(`[${PRESET_GROUP_ATTR}="true"]`);
    if (!group) {
      return;
    }

    updateActions(section, store, liveOptions);

    const signature = getSignature(store, liveOptions, liveOptions.length > 0);
    if (wrapper.getAttribute(SIGNATURE_ATTR) === signature) {
      return;
    }

    wrapper.setAttribute(SIGNATURE_ATTR, signature);
    renderPresetChips(section, wrapper, store, liveOptions);
    renderEditor(section, wrapper, store, liveOptions);
  }

  function syncAllSections() {
    if (!isModelsPage()) {
      return;
    }

    ensureStyles();

    for (const section of getBaseModelSections()) {
      syncSection(section);
    }
  }

  function startModelsPageObserver() {
    if (modelsPageObserver || !document.body) {
      return;
    }

    modelsPageObserver = new MutationObserver(() => {
      scheduleSync();
    });

    modelsPageObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopModelsPageObserver() {
    if (!modelsPageObserver) {
      return;
    }

    modelsPageObserver.disconnect();
    modelsPageObserver = null;
  }

  function resetPageState() {
    editorState = null;
  }

  function refreshModelsPageLifecycle() {
    if (isModelsPage()) {
      ensureStyles();
      startModelsPageObserver();
      scheduleSync();
      return;
    }

    stopModelsPageObserver();
    resetPageState();
  }

  function installHistoryHooks() {
    const methods = ['pushState', 'replaceState'];

    for (const method of methods) {
      const original = history[method];
      if (typeof original !== 'function' || original.__tmBaseModelPresetsWrapped) {
        continue;
      }

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        refreshModelsPageLifecycle();
        return result;
      };

      wrapped.__tmBaseModelPresetsWrapped = true;
      history[method] = wrapped;
    }
  }

  function start() {
    installHistoryHooks();
    refreshModelsPageLifecycle();
    window.addEventListener('popstate', refreshModelsPageLifecycle);
    window.addEventListener('hashchange', refreshModelsPageLifecycle);
    window.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) {
        scheduleSync();
      }
    });
  }

  if (document.readyState === 'loading') {
    installRequestInterceptors();
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    installRequestInterceptors();
    start();
  }
})();
