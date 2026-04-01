// ==UserScript==
// @name         Civitai Base Model Chips
// @namespace    https://civitai.com/
// @version      1.4.0
// @author       lericogit
// @description  Replaces the Base model dropdown with chip-style filters on the Civitai models page.
// @license      MIT
// @homepageURL  https://github.com/lericogit/civitai-base-model-chips
// @supportURL   https://github.com/lericogit/civitai-base-model-chips/issues
// @match        https://civitai.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_KEY = 'tm-civitai-base-model-chips';
  const STYLE_ID = `${SCRIPT_KEY}-style`;
  const WRAPPER_ATTR = 'data-tm-base-model-chips';
  const HIDDEN_ATTR = 'data-tm-base-model-hidden';
  const GROUP_ATTR = 'data-tm-base-model-chip-group';
  const DIVIDER_ACTIONS_ATTR = 'data-tm-base-model-divider-actions';
  const COPY_BUTTON_ATTR = 'data-tm-base-model-copy-button';
  const COPY_BUTTON_LABEL_ATTR = 'data-tm-base-model-copy-button-label';
  const COPY_BUTTON_ICON_ATTR = 'data-tm-base-model-copy-button-icon';
  const SIGNATURE_ATTR = 'data-tm-base-model-signature';
  const MODELS_PATH_PATTERN = /^\/models(?:\/|$)/i;
  const FILTER_MODES = {
    OFF: 'off',
    BLACKLIST: 'blacklist',
    WHITELIST: 'whitelist',
  };

  /*
   * ========================================================================
   * ====================== USER CONFIG - START HERE ========================
   * ========================================================================
   * Edit only this block if you want to customize the script.
   *
   * MODE:
   *   FILTER_MODES.OFF
   *   FILTER_MODES.BLACKLIST
   *   FILTER_MODES.WHITELIST
   *
   * IMPORTANT:
   * - These settings are visual-only.
   * - They only affect the custom chips added by this userscript.
   * - The real hidden dropdown stays intact and unchanged.
   * ========================================================================
   */

  const MODE = FILTER_MODES.OFF;

  const ALL_BASE_MODELS = [
    'Anima',
    'AuraFlow',
    'Chroma',
    'CogVideoX',
    'Flux.1 S',
    'Flux.1 D',
    'Flux.1 Krea',
    'Flux.1 Kontext',
    'Flux.2 D',
    'Flux.2 Klein 9B',
    'Flux.2 Klein 9B-base',
    'Flux.2 Klein 4B',
    'Flux.2 Klein 4B-base',
    'Grok',
    'HiDream',
    'Hunyuan 1',
    'Hunyuan Video',
    'Illustrious',
    'NoobAI',
    'Kolors',
    'LTXV',
    'LTXV2',
    'LTXV 2.3',
    'Lumina',
    'Mochi',
    'Other',
    'PixArt a',
    'PixArt E',
    'Pony',
    'Pony V7',
    'Qwen',
    'Qwen 2',
    'Wan Video 1.3B t2v',
    'Wan Video 14B t2v',
    'Wan Video 14B i2v 480p',
    'Wan Video 14B i2v 720p',
    'Wan Video 2.2 TI2V-5B',
    'Wan Video 2.2 I2V-A14B',
    'Wan Video 2.2 T2V-A14B',
    'Wan Video 2.5 T2V',
    'Wan Video 2.5 I2V',
    'SD 1.4',
    'SD 1.5',
    'SD 1.5 LCM',
    'SD 1.5 Hyper',
    'SD 2.0',
    'SD 2.1',
    'SDXL 1.0',
    'SDXL Lightning',
    'SDXL Hyper',
    'ZImageTurbo',
    'ZImageBase',
  ];

  const BLACKLIST = [
    // 'Flux.2 Klein 9B',
  ];

  const WHITELIST = [
    'Flux.2 Klein 9B',
    'Flux.2 Klein 9B-base',
    'Flux.2 Klein 4B',
    'Flux.2 Klein 4B-base',
    'ZImageTurbo',
    'ZImageBase',
    'Wan Video 2.2 I2V-A14B',
    'Wan Video 2.2 T2V-A14B',
    'LTXV2',
    'LTXV 2.3',
  ];

  /*
   * ========================================================================
   * ======================= USER CONFIG - END HERE =========================
   * ========================================================================
   */

  let chipIdCounter = 0;
  let syncQueued = false;

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeKey(text) {
    return normalizeText(text).toLowerCase();
  }

  function escapeJsString(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${HIDDEN_ATTR}="true"] > .mantine-InputWrapper-root {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        margin: -1px !important;
        padding: 0 !important;
        overflow: hidden !important;
        clip: rect(0 0 0 0) !important;
        clip-path: inset(50%) !important;
        white-space: nowrap !important;
        border: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      [${HIDDEN_ATTR}="true"] > .mantine-MultiSelect-dropdown {
        display: none !important;
      }

      [${WRAPPER_ATTR}="true"] {
        width: 100%;
      }

      [${DIVIDER_ACTIONS_ATTR}="true"] {
        position: relative;
        padding-right: calc(8rem * var(--mantine-scale, 1));
      }

      [${COPY_BUTTON_ATTR}="true"] {
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
        padding: calc(0.2rem * var(--mantine-scale, 1)) calc(0.5rem * var(--mantine-scale, 1));
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 1;
        transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
      }

      [${COPY_BUTTON_ICON_ATTR}="true"] {
        display: none;
        flex: 0 0 auto;
        width: 0.85rem;
        height: 0.85rem;
      }

      [${COPY_BUTTON_ATTR}="true"][data-warning="true"] {
        background: rgba(255, 212, 59, 0.14);
        border-color: #f59f00;
        color: #8f5b00;
      }

      [${COPY_BUTTON_ATTR}="true"][data-warning="true"] [${COPY_BUTTON_ICON_ATTR}="true"] {
        display: inline-flex;
      }

      [${COPY_BUTTON_ATTR}="true"]:hover {
        background: var(--mantine-color-default-hover, rgba(0, 0, 0, 0.05));
      }

      [${COPY_BUTTON_ATTR}="true"][data-warning="true"]:hover {
        background: rgba(255, 212, 59, 0.22);
      }

      [${COPY_BUTTON_ATTR}="true"][data-state="copied"] {
        color: var(--mantine-color-green-7, #2b8a3e);
        border-color: var(--mantine-color-green-6, #40c057);
      }

      [${COPY_BUTTON_ATTR}="true"][data-state="error"] {
        color: var(--mantine-color-red-7, #c92a2a);
        border-color: var(--mantine-color-red-6, #fa5252);
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

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;

    try {
      copied = document.execCommand('copy');
    } finally {
      textarea.remove();
    }

    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  }

  function setCopyButtonLabel(button, label) {
    const labelNode = button?.querySelector(`[${COPY_BUTTON_LABEL_ATTR}="true"]`);
    if (labelNode) {
      labelNode.textContent = label;
      return;
    }

    if (button) {
      button.textContent = label;
    }
  }

  function setCopyButtonState(button, state, label) {
    if (!button) {
      return;
    }

    if (button._tmCopyResetTimer) {
      window.clearTimeout(button._tmCopyResetTimer);
    }

    button.dataset.state = state;
    setCopyButtonLabel(button, label);

    if (state === 'idle') {
      return;
    }

    button._tmCopyResetTimer = window.setTimeout(() => {
      button.dataset.state = 'idle';
      setCopyButtonLabel(button, 'Copy model list');
    }, 1800);
  }

  function getModelsMissingFromHardcodedList(options) {
    const hardcodedModels = new Set(
      ALL_BASE_MODELS
        .map((value) => normalizeKey(value))
        .filter(Boolean)
    );
    const missingModels = [];

    for (const option of options) {
      const key = normalizeKey(option.value);
      if (!key || hardcodedModels.has(key)) {
        continue;
      }

      hardcodedModels.add(key);
      missingModels.push(option.value);
    }

    return missingModels;
  }

  function buildMissingModelsMessage(missingModels) {
    const count = missingModels.length;
    if (!count) {
      return '';
    }

    const modelLabel = count === 1 ? 'model' : 'models';
    const verb = count === 1 ? 'has' : 'have';
    return `New base ${modelLabel} ${verb} been added to Civitai and ${count === 1 ? 'is' : 'are'} missing from ALL_BASE_MODELS. Click "Copy model list" and update the hardcoded list manually. New ${modelLabel}: ${missingModels.join(', ')}.`;
  }

  function updateCopyButtonWarning(button, options) {
    if (!button) {
      return;
    }

    const missingModels = getModelsMissingFromHardcodedList(options);
    const hasWarning = missingModels.length > 0;

    if (!hasWarning) {
      button.dataset.warning = 'false';
      button.title = 'Copy the live Base model dropdown values as const ALL_BASE_MODELS = [...]';
      button.setAttribute('aria-label', 'Copy model list');
      return;
    }

    const message = buildMissingModelsMessage(missingModels);
    button.dataset.warning = 'true';
    button.title = message;
    button.setAttribute('aria-label', `Copy model list. Warning: ${message}`);
  }

  function formatAllBaseModelsConstant(options) {
    const lines = options.map((option) => `  '${escapeJsString(option.value)}',`);
    return ['const ALL_BASE_MODELS = [', ...lines, '];'].join('\n');
  }

  async function handleCopyModelList(section, button) {
    try {
      const options = getOptions(section);
      if (!options.length) {
        setCopyButtonState(button, 'error', 'No models');
        return;
      }

      await copyTextToClipboard(formatAllBaseModelsConstant(options));
      setCopyButtonState(button, 'copied', 'Copied');
    } catch (error) {
      console.error(`${SCRIPT_KEY}: failed to copy base model list`, error);
      setCopyButtonState(button, 'error', 'Copy failed');
    }
  }

  function ensureCopyButton(section) {
    const divider = section.querySelector('.mantine-Divider-root');
    if (!divider) {
      return null;
    }

    divider.setAttribute(DIVIDER_ACTIONS_ATTR, 'true');

    let button = divider.querySelector(`[${COPY_BUTTON_ATTR}="true"]`);
    if (button) {
      return button;
    }

    button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(COPY_BUTTON_ATTR, 'true');
    button.dataset.state = 'idle';
    button.dataset.warning = 'false';
    button.title = 'Copy the live Base model dropdown values as const ALL_BASE_MODELS = [...]';
    button.setAttribute('aria-label', 'Copy model list');

    const icon = document.createElement('span');
    icon.setAttribute(COPY_BUTTON_ICON_ATTR, 'true');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14">
        <path d="M10 2.5L18 17H2L10 2.5Z" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
        <path d="M10 7V11.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"></path>
        <circle cx="10" cy="14.2" r="1" fill="currentColor"></circle>
      </svg>
    `;

    const label = document.createElement('span');
    label.setAttribute(COPY_BUTTON_LABEL_ATTR, 'true');
    label.textContent = 'Copy model list';

    button.append(icon, label);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleCopyModelList(section, button);
    });

    divider.appendChild(button);
    return button;
  }

  function scheduleSync() {
    if (syncQueued) {
      return;
    }

    syncQueued = true;

    requestAnimationFrame(() => {
      syncQueued = false;
      syncAllSections();
    });
  }

  function isModelsPage() {
    return MODELS_PATH_PATTERN.test(window.location.pathname);
  }

  function getBaseModelSections() {
    return [...document.querySelectorAll('.mantine-Divider-label')]
      .filter((label) => normalizeText(label.textContent).toLowerCase() === 'base model')
      .map((label) => label.closest('.mantine-Stack-root'))
      .filter(Boolean);
  }

  function getMultiSelectRoot(section) {
    return section.querySelector('.mantine-MultiSelect-root');
  }

  function getOptionNodes(section) {
    return [...section.querySelectorAll('.mantine-MultiSelect-option[data-combobox-option]')];
  }

  function getOptions(section) {
    const seen = new Set();
    const options = [];

    for (const node of getOptionNodes(section)) {
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

  function buildKnownModelLookup(options) {
    const lookup = new Map();

    for (const value of ALL_BASE_MODELS) {
      const normalized = normalizeText(value);
      if (!normalized) {
        continue;
      }

      lookup.set(normalizeKey(normalized), normalized);
    }

    for (const option of options) {
      lookup.set(normalizeKey(option.value), option.value);
    }

    return lookup;
  }

  function resolveConfiguredValues(values, lookup, availableValues) {
    if (!Array.isArray(values)) {
      return new Set();
    }

    const resolved = new Set();

    for (const rawValue of values) {
      const normalized = normalizeText(typeof rawValue === 'string' ? rawValue : '');
      if (!normalized) {
        continue;
      }

      const canonicalValue = lookup.get(normalizeKey(normalized));
      if (canonicalValue && availableValues.has(canonicalValue)) {
        resolved.add(canonicalValue);
      }
    }

    return resolved;
  }

  function getVisualFilterConfig(options) {
    const availableValues = new Set(options.map((option) => option.value));
    const lookup = buildKnownModelLookup(options);
    const mode = normalizeKey(MODE);
    const blacklist = resolveConfiguredValues(BLACKLIST, lookup, availableValues);
    const whitelist = resolveConfiguredValues(WHITELIST, lookup, availableValues);

    if (mode === FILTER_MODES.BLACKLIST) {
      if (blacklist.size === 0 || blacklist.size >= options.length) {
        return { mode: FILTER_MODES.OFF, values: new Set() };
      }

      return { mode, values: blacklist };
    }

    if (mode === FILTER_MODES.WHITELIST) {
      if (whitelist.size === 0) {
        return { mode: FILTER_MODES.OFF, values: new Set() };
      }

      return { mode, values: whitelist };
    }

    return { mode: FILTER_MODES.OFF, values: new Set() };
  }

  function getVisibleChipOptions(options, selectedValues) {
    const filterConfig = getVisualFilterConfig(options);

    if (filterConfig.mode === FILTER_MODES.OFF) {
      return options;
    }

    const visibleOptions = options.filter((option) => {
      if (selectedValues.has(option.value)) {
        return true;
      }

      if (filterConfig.mode === FILTER_MODES.BLACKLIST) {
        return !filterConfig.values.has(option.value);
      }

      return filterConfig.values.has(option.value);
    });

    return visibleOptions.length ? visibleOptions : options;
  }

  function getSelectedValues(section) {
    const hiddenInput = section.querySelector('.mantine-MultiSelect-root input[type="hidden"]');
    if (hiddenInput) {
      return hiddenInput.value
        .split(',')
        .map((value) => normalizeText(value))
        .filter(Boolean);
    }

    return getOptionNodes(section)
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

  function buildLabelContent(templateLabel, text) {
    const icon = templateLabel.querySelector('.mantine-Chip-iconWrapper');
    const outer = document.createElement('span');
    const inner = document.createElement('span');

    inner.textContent = text;
    outer.appendChild(inner);

    return icon ? [icon.cloneNode(true), outer] : [outer];
  }

  function findOptionNode(section, value) {
    return getOptionNodes(section)
      .find((node) => normalizeText(node.getAttribute('value') || node.textContent) === value) || null;
  }

  function clearSelections(section) {
    const clearButton = section.querySelector('.mantine-InputClearButton-root');
    if (clearButton) {
      clearButton.click();
      scheduleSync();
      return;
    }

    const selectedValues = getSelectedValues(section);

    for (const value of selectedValues) {
      const optionNode = findOptionNode(section, value);
      if (optionNode) {
        optionNode.click();
        continue;
      }

      const pill = [...section.querySelectorAll('.mantine-MultiSelect-pill')]
        .find((node) => normalizeText(node.querySelector('.mantine-Pill-label')?.textContent) === value);
      const removeButton = pill?.querySelector('.mantine-Pill-remove');
      if (removeButton) {
        removeButton.click();
      }
    }

    scheduleSync();
  }

  function toggleSelection(section, value) {
    const optionNode = findOptionNode(section, value);
    if (optionNode) {
      optionNode.click();
      scheduleSync();
      return;
    }

    const input = section.querySelector('.mantine-MultiSelect-inputField, .mantine-PillsInputField-field');
    if (!input) {
      return;
    }

    input.focus();
    input.click();

    window.setTimeout(() => {
      const delayedOptionNode = findOptionNode(section, value);
      if (delayedOptionNode) {
        delayedOptionNode.click();
      }

      scheduleSync();
    }, 30);
  }

  function createChip(section, templates, value, text, selected, isClearChip) {
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

    if (selected) {
      input.setAttribute('checked', '');
      label.setAttribute('data-checked', 'true');
    } else {
      input.removeAttribute('checked');
      label.removeAttribute('data-checked');
    }

    label.htmlFor = input.id;
    label.replaceChildren(...buildLabelContent(label, text));

    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (isClearChip) {
        clearSelections(section);
        return;
      }

      toggleSelection(section, value);
    });

    return chip;
  }

  function getOrCreateGroup(section) {
    let wrapper = section.querySelector(`[${WRAPPER_ATTR}="true"]`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.setAttribute(WRAPPER_ATTR, 'true');

      const group = getGroupTemplate();
      group.setAttribute(GROUP_ATTR, 'true');
      wrapper.appendChild(group);

      const multiSelectRoot = getMultiSelectRoot(section);
      if (multiSelectRoot) {
        multiSelectRoot.insertAdjacentElement('afterend', wrapper);
      } else {
        section.appendChild(wrapper);
      }
    }

    return wrapper.querySelector(`[${GROUP_ATTR}="true"]`);
  }

  function signatureFor(options, selectedValues) {
    return JSON.stringify({
      options: options.map((option) => `${option.value}:${option.label}`),
      selected: [...selectedValues].sort(),
    });
  }

  function syncSection(section) {
    const multiSelectRoot = getMultiSelectRoot(section);
    if (!multiSelectRoot) {
      return;
    }

    const options = getOptions(section);
    if (!options.length) {
      return;
    }

    hideElement(multiSelectRoot);
    hideElement(section.querySelector('.mantine-MultiSelect-dropdown'));

    const selectedValues = new Set(getSelectedValues(section));
    const visibleOptions = getVisibleChipOptions(options, selectedValues);
    const copyButton = ensureCopyButton(section);
    updateCopyButtonWarning(copyButton, options);
    const group = getOrCreateGroup(section);
    const wrapper = group.parentElement;
    const signature = signatureFor(visibleOptions, selectedValues);

    if (wrapper.getAttribute(SIGNATURE_ATTR) === signature) {
      return;
    }

    wrapper.setAttribute(SIGNATURE_ATTR, signature);

    const templates = getChipTemplates();
    if (!templates.unchecked) {
      return;
    }

    const fragment = document.createDocumentFragment();

    const clearChip = createChip(
      section,
      templates,
      '__all__',
      'All Base Models',
      selectedValues.size === 0,
      true
    );
    if (clearChip) {
      fragment.appendChild(clearChip);
    }

    for (const option of visibleOptions) {
      const chip = createChip(
        section,
        templates,
        option.value,
        option.label,
        selectedValues.has(option.value),
        false
      );

      if (chip) {
        fragment.appendChild(chip);
      }
    }

    group.replaceChildren(fragment);
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

  function installHistoryHooks() {
    const methods = ['pushState', 'replaceState'];

    for (const method of methods) {
      const original = history[method];
      if (typeof original !== 'function' || original.__tmBaseModelWrapped) {
        continue;
      }

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        scheduleSync();
        return result;
      };

      wrapped.__tmBaseModelWrapped = true;
      history[method] = wrapped;
    }
  }

  function start() {
    ensureStyles();
    installHistoryHooks();
    scheduleSync();

    const observer = new MutationObserver(() => {
      scheduleSync();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.setInterval(scheduleSync, 1000);
    window.addEventListener('popstate', scheduleSync);
    window.addEventListener('hashchange', scheduleSync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
