// ==UserScript==
// @name         Gmail Superpowers
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.3.0
// @description  Portable Gmail search links plus local per-thread status notes.
// @author       menteora
// @match        https://mail.google.com/mail/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @homepageURL  https://github.com/menteora/gmail-superpowers
// @supportURL   https://github.com/menteora/gmail-superpowers/issues
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ROW_CLASS = 'gmail-superpowers-row-actions';
  const OPEN_ACTIONS_ID = 'gmail-superpowers-open-actions';
  const NOTE_PANEL_ID = 'gmail-superpowers-note-panel';
  const TOAST_ID = 'gmail-superpowers-toast';
  const STYLE_ID = 'gmail-superpowers-style';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const DB_NAME = 'gmail-superpowers';
  const DB_VERSION = 1;
  const NOTE_STORE = 'thread-notes';

  let dbPromise = null;

  const ICON_PATHS = {
    url: [
      'M10.59 13.41a2 2 0 0 0 2.82 0l4-4a2 2 0 1 0-2.82-2.82l-1.17 1.17a1 1 0 0 1-1.42-1.42l1.17-1.17a4 4 0 1 1 5.66 5.66l-4 4a4 4 0 0 1-5.66 0 1 1 0 0 1 1.42-1.42Z',
      'M13.41 10.59a2 2 0 0 0-2.82 0l-4 4a2 2 0 1 0 2.82 2.82l1.17-1.17A1 1 0 0 1 12 19.66l-1.17 1.17a4 4 0 1 1-5.66-5.66l4-4a4 4 0 0 1 5.66 0 1 1 0 1 1-1.42 1.42Z'
    ],
    markdown: [
      'M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h18V7H3Z',
      'M5 9h2l2 2.5L11 9h2v6h-2v-3.2l-2 2.4-2-2.4V15H5V9Zm10 0h2v3h2.2L17 15.2 14.8 12H17V9h2v1h2l-4 5.5L13 10h2V9Z'
    ],
    save: [
      'M9.55 17.45 4.8 12.7l1.4-1.4 3.35 3.35 8.25-8.25 1.4 1.4-9.65 9.65Z'
    ],
    trash: [
      'M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm0-2h10V9H7v10Zm2-2h2v-6H9v6Zm4 0h2v-6h-2v6ZM4 5V3h5l1-1h4l1 1h5v2H4Z'
    ]
  };

  function createSvgIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    for (const d of ICON_PATHS[kind] || []) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }

    return svg;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${ROW_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-left: 7px;
        vertical-align: middle;
        flex: 0 0 auto;
      }

      .gmail-superpowers-icon-button,
      .gmail-superpowers-note-button {
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: #5f6368;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        position: relative;
        z-index: 20;
        pointer-events: auto !important;
      }

      .gmail-superpowers-icon-button {
        width: 26px;
        height: 26px;
        padding: 4px;
      }

      .gmail-superpowers-icon-button:hover,
      .gmail-superpowers-note-button:hover {
        background: rgba(60, 64, 67, .12);
        color: #202124;
      }

      .gmail-superpowers-icon-button:active,
      .gmail-superpowers-note-button:active {
        background: rgba(60, 64, 67, .20);
      }

      .gmail-superpowers-icon-button svg,
      .gmail-superpowers-note-button svg {
        width: 17px;
        height: 17px;
        fill: currentColor;
        pointer-events: none;
      }

      #${OPEN_ACTIONS_ID} {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-left: 8px;
        vertical-align: middle;
        position: relative;
        z-index: 20;
        pointer-events: auto !important;
      }

      #${OPEN_ACTIONS_ID} .gmail-superpowers-icon-button {
        width: 30px;
        height: 30px;
      }

      #${NOTE_PANEL_ID} {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 6px 0 10px 0;
        min-height: 34px;
        max-width: 760px;
        position: relative;
        z-index: 20;
        font-family: Arial, sans-serif;
      }

      .gmail-superpowers-note-label {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 600;
        color: #5f6368;
      }

      .gmail-superpowers-note-input {
        flex: 1 1 auto;
        min-width: 120px;
        height: 32px;
        padding: 5px 10px;
        border: 1px solid #dadce0;
        border-radius: 8px;
        outline: none;
        background: #fff;
        color: #202124;
        font: 13px/20px Arial, sans-serif;
        box-sizing: border-box;
        pointer-events: auto !important;
      }

      .gmail-superpowers-note-input:focus {
        border-color: #1a73e8;
        box-shadow: 0 0 0 1px #1a73e8;
      }

      .gmail-superpowers-note-button {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        padding: 5px;
      }

      .gmail-superpowers-note-button[disabled] {
        opacity: .32;
        cursor: default;
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  }

  function cleanText(value) {
    return (value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findOpenMailSubjectElement() {
    const selectors = [
      'h2.hP',
      '.ha h2',
      '[data-thread-perm-id] h2'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        const subject = cleanText(element.textContent);
        if (subject && rect.width > 0 && rect.height > 0) return element;
      }
    }

    return null;
  }

  function getOpenMailSubject() {
    return cleanText(findOpenMailSubjectElement()?.textContent);
  }

  function getRowSubject(row) {
    const subjectElement =
      row.querySelector('span.bog') ||
      row.querySelector('.y6 span') ||
      row.querySelector('[data-thread-id] span');

    return cleanText(subjectElement?.textContent);
  }

  function getAccountScope() {
    const match = location.pathname.match(/\/mail\/u\/(\d+)\//);
    return match ? `u${match[1]}` : 'u-default';
  }

  function getOpenThreadId() {
    const rawHash = location.hash || '';
    const parts = rawHash.split('/').filter(Boolean);
    const candidate = parts[parts.length - 1] || '';

    if (!candidate || candidate.length < 8) return '';

    const lower = candidate.toLowerCase();
    const reserved = new Set([
      '#inbox', 'inbox', 'sent', 'drafts', 'starred', 'important',
      'all', 'spam', 'trash', 'search'
    ]);

    if (reserved.has(lower)) return '';
    if (candidate.includes('%22') || candidate.includes('%3a') || candidate.includes(' ')) return '';

    return candidate.replace(/^#/, '');
  }

  function buildNoteKey(subject) {
    const account = getAccountScope();
    const threadId = getOpenThreadId();

    if (threadId) return `${account}:thread:${threadId}`;
    return `${account}:subject:${cleanText(subject).toLowerCase()}`;
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(NOTE_STORE)) {
          db.createObjectStore(NOTE_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB non disponibile'));
    });

    return dbPromise;
  }

  async function getNoteRecord(key) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTE_STORE, 'readonly');
      const request = tx.objectStore(NOTE_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Errore lettura nota'));
    });
  }

  async function saveNoteRecord(key, subject, text) {
    const db = await openDatabase();
    const value = cleanText(text);

    if (!value) {
      await deleteNoteRecord(key);
      return null;
    }

    const record = {
      key,
      subject,
      text: value,
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTE_STORE, 'readwrite');
      const request = tx.objectStore(NOTE_STORE).put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error || new Error('Errore salvataggio nota'));
    });
  }

  async function deleteNoteRecord(key) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(NOTE_STORE, 'readwrite');
      const request = tx.objectStore(NOTE_STORE).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Errore eliminazione nota'));
    });
  }

  function escapeGmailSearchValue(value) {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  function escapeMarkdownLabel(value) {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
  }

  function buildGmailSearch(subject) {
    const query = `subject:"${escapeGmailSearchValue(subject)}"`;
    const url = `https://mail.google.com/mail/#search/${encodeURIComponent(query)}`;
    const markdown = `[email: ${escapeMarkdownLabel(subject)}](${url})`;

    return { query, url, markdown };
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();

    const ok = document.execCommand('copy');
    textarea.remove();

    if (!ok) throw new Error('Clipboard non disponibile');
  }

  function showToast(message, isError = false) {
    document.getElementById(TOAST_ID)?.remove();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = message;

    Object.assign(toast.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '2147483647',
      maxWidth: '440px',
      padding: '10px 14px',
      borderRadius: '8px',
      background: isError ? '#b3261e' : '#202124',
      color: '#fff',
      font: '13px/1.4 Arial, sans-serif',
      boxShadow: '0 4px 18px rgba(0,0,0,.25)'
    });

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }

  function stopPropagationOnly(event) {
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function stopAction(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function createIconButton(kind, getSubject) {
    const isMarkdown = kind === 'markdown';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gmail-superpowers-icon-button';
    button.appendChild(createSvgIcon(kind));
    button.title = isMarkdown ? 'Copia Gmail Search in Markdown' : 'Copia URL Gmail Search';
    button.setAttribute('aria-label', button.title);

    button.addEventListener('pointerdown', stopPropagationOnly, true);
    button.addEventListener('mousedown', stopPropagationOnly, true);

    button.addEventListener('click', async (event) => {
      stopAction(event);

      const subject = cleanText(getSubject());
      if (!subject) {
        showToast('Oggetto email non trovato.', true);
        return;
      }

      const search = buildGmailSearch(subject);
      const value = isMarkdown ? search.markdown : search.url;

      try {
        await copyText(value);
        showToast(isMarkdown ? 'Markdown copiato' : 'URL Gmail Search copiato');
        console.debug('[Gmail Superpowers] Copied:', { kind, subject, value });
      } catch (error) {
        console.error('[Gmail Superpowers] Clipboard error:', error);
        showToast('Non riesco a copiare negli appunti.', true);
      }
    }, true);

    return button;
  }

  function createActionGroup(className, getSubject) {
    const group = document.createElement('span');
    group.className = className;
    group.appendChild(createIconButton('url', getSubject));
    group.appendChild(createIconButton('markdown', getSubject));
    return group;
  }

  function createNoteButton(kind, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gmail-superpowers-note-button';
    button.appendChild(createSvgIcon(kind));
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('pointerdown', stopPropagationOnly, true);
    button.addEventListener('mousedown', stopPropagationOnly, true);
    button.addEventListener('click', async (event) => {
      stopAction(event);
      await onClick(button);
    }, true);
    return button;
  }

  function findRowActionsHost(row) {
    const subject = row.querySelector('span.bog');
    if (!subject) return null;

    return subject.closest('.y6') || subject.parentElement;
  }

  function enhanceMailRow(row) {
    if (!(row instanceof HTMLElement)) return;
    if (row.querySelector(`.${ROW_CLASS}`)) return;

    const subject = getRowSubject(row);
    if (!subject) return;

    const host = findRowActionsHost(row);
    if (!host) return;

    const group = createActionGroup(ROW_CLASS, () => getRowSubject(row));
    host.appendChild(group);
  }

  function enhanceMailRows() {
    document.querySelectorAll('tr.zA').forEach(enhanceMailRow);
  }

  function enhanceOpenMessage() {
    const subjectElement = findOpenMailSubjectElement();

    if (!subjectElement) {
      document.getElementById(OPEN_ACTIONS_ID)?.remove();
      return;
    }

    const existing = document.getElementById(OPEN_ACTIONS_ID);
    if (existing) {
      if (existing.previousElementSibling !== subjectElement) {
        existing.remove();
      } else {
        return;
      }
    }

    const group = createActionGroup('', () => cleanText(subjectElement.textContent));
    group.id = OPEN_ACTIONS_ID;
    subjectElement.insertAdjacentElement('afterend', group);
  }

  async function enhanceOpenNote() {
    const subjectElement = findOpenMailSubjectElement();

    if (!subjectElement) {
      document.getElementById(NOTE_PANEL_ID)?.remove();
      return;
    }

    const subject = cleanText(subjectElement.textContent);
    const noteKey = buildNoteKey(subject);
    const existing = document.getElementById(NOTE_PANEL_ID);

    if (existing?.dataset.noteKey === noteKey) return;
    existing?.remove();

    const panel = document.createElement('div');
    panel.id = NOTE_PANEL_ID;
    panel.dataset.noteKey = noteKey;

    const label = document.createElement('span');
    label.className = 'gmail-superpowers-note-label';
    label.textContent = 'Stato';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gmail-superpowers-note-input';
    input.placeholder = 'Es. Aspetto risposta da X e Y';
    input.autocomplete = 'off';
    input.spellcheck = true;
    input.dataset.savedValue = '';
    input.addEventListener('pointerdown', stopPropagationOnly, true);
    input.addEventListener('mousedown', stopPropagationOnly, true);
    input.addEventListener('click', stopPropagationOnly, true);

    const saveButton = createNoteButton('save', 'Salva stato', async () => {
      const value = cleanText(input.value);

      try {
        await saveNoteRecord(noteKey, subject, value);
        input.value = value;
        input.dataset.savedValue = value;
        deleteButton.disabled = !value;
        showToast(value ? 'Stato salvato' : 'Stato eliminato');
      } catch (error) {
        console.error('[Gmail Superpowers] Note save error:', error);
        showToast('Non riesco a salvare lo stato.', true);
      }
    });

    const deleteButton = createNoteButton('trash', 'Cancella stato', async () => {
      try {
        await deleteNoteRecord(noteKey);
        input.value = '';
        input.dataset.savedValue = '';
        deleteButton.disabled = true;
        input.focus();
        showToast('Stato eliminato');
      } catch (error) {
        console.error('[Gmail Superpowers] Note delete error:', error);
        showToast('Non riesco a cancellare lo stato.', true);
      }
    });
    deleteButton.disabled = true;

    async function saveIfChanged() {
      const value = cleanText(input.value);
      const saved = input.dataset.savedValue || '';
      if (value === saved) return;

      try {
        await saveNoteRecord(noteKey, subject, value);
        input.value = value;
        input.dataset.savedValue = value;
        deleteButton.disabled = !value;
      } catch (error) {
        console.error('[Gmail Superpowers] Note autosave error:', error);
        showToast('Non riesco a salvare lo stato.', true);
      }
    }

    input.addEventListener('keydown', async (event) => {
      event.stopPropagation();

      if (event.key === 'Enter') {
        event.preventDefault();
        await saveIfChanged();
        showToast(input.value.trim() ? 'Stato salvato' : 'Stato eliminato');
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = input.dataset.savedValue || '';
        input.blur();
      }
    });

    input.addEventListener('blur', saveIfChanged);

    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(saveButton);
    panel.appendChild(deleteButton);

    const subjectHost = subjectElement.closest('.ha') || subjectElement.parentElement;
    if (!subjectHost) return;
    subjectHost.insertAdjacentElement('afterend', panel);

    try {
      const record = await getNoteRecord(noteKey);
      if (!document.contains(panel) || panel.dataset.noteKey !== noteKey) return;

      const value = cleanText(record?.text || '');
      input.value = value;
      input.dataset.savedValue = value;
      deleteButton.disabled = !value;
    } catch (error) {
      console.error('[Gmail Superpowers] Note load error:', error);
      showToast('Non riesco a caricare lo stato locale.', true);
    }
  }

  let refreshTimer = null;

  function scheduleRefresh() {
    if (refreshTimer) return;

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      injectStyles();
      enhanceMailRows();
      enhanceOpenMessage();
      enhanceOpenNote();
    }, 100);
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);

  injectStyles();
  scheduleRefresh();
})();
