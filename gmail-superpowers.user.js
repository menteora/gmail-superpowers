// ==UserScript==
// @name         Gmail Superpowers
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.2.1
// @description  Copy a portable Gmail subject search as URL or Markdown from message rows and opened emails.
// @author       menteora
// @match        https://mail.google.com/mail/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @homepageURL  https://github.com/menteora/gmail-superpowers
// @supportURL   https://github.com/menteora/gmail-superpowers/issues
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.meta.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ROW_CLASS = 'gmail-superpowers-row-actions';
  const TOOLBAR_ID = 'gmail-superpowers-toolbar-actions';
  const TOAST_ID = 'gmail-superpowers-toast';
  const STYLE_ID = 'gmail-superpowers-style';

  const ICON_LINK = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.59 13.41a2 2 0 0 0 2.82 0l4-4a2 2 0 1 0-2.82-2.82l-1.17 1.17a1 1 0 0 1-1.42-1.42l1.17-1.17a4 4 0 1 1 5.66 5.66l-4 4a4 4 0 0 1-5.66 0 1 1 0 0 1 1.42-1.42Z"/>
      <path d="M13.41 10.59a2 2 0 0 0-2.82 0l-4 4a2 2 0 1 0 2.82 2.82l1.17-1.17A1 1 0 0 1 12 19.66l-1.17 1.17a4 4 0 1 1-5.66-5.66l4-4a4 4 0 0 1 5.66 0 1 1 0 1 1-1.42 1.42Z"/>
    </svg>`;

  const ICON_MD = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h18V7H3Z"/>
      <path d="M5 9h2l2 2.5L11 9h2v6h-2v-3.2l-2 2.4-2-2.4V15H5V9Zm10 0h2v3h2.2L17 15.2 14.8 12H17V9h2v1h2l-4 5.5L13 10h2V9Z"/>
    </svg>`;

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

      .gmail-superpowers-icon-button {
        width: 26px;
        height: 26px;
        padding: 4px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: #5f6368;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }

      .gmail-superpowers-icon-button:hover {
        background: rgba(60, 64, 67, .12);
        color: #202124;
      }

      .gmail-superpowers-icon-button:active {
        background: rgba(60, 64, 67, .20);
      }

      .gmail-superpowers-icon-button svg {
        width: 17px;
        height: 17px;
        fill: currentColor;
        pointer-events: none;
      }

      #${TOOLBAR_ID} {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-left: 6px;
      }

      #${TOOLBAR_ID} .gmail-superpowers-icon-button {
        width: 32px;
        height: 32px;
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

  function getOpenMailSubject() {
    const selectors = [
      'h2.hP',
      '.ha h2',
      '[data-thread-perm-id] h2'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const subject = cleanText(element.textContent);
        if (subject) return subject;
      }
    }

    return '';
  }

  function getRowSubject(row) {
    const subjectElement =
      row.querySelector('span.bog') ||
      row.querySelector('.y6 span') ||
      row.querySelector('[data-thread-id] span');

    return cleanText(subjectElement?.textContent);
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

  function stopMailOpen(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function createIconButton(kind, getSubject) {
    const isMarkdown = kind === 'markdown';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gmail-superpowers-icon-button';
    button.innerHTML = isMarkdown ? ICON_MD : ICON_LINK;
    button.title = isMarkdown ? 'Copia Gmail Search in Markdown' : 'Copia URL Gmail Search';
    button.setAttribute('aria-label', button.title);

    button.addEventListener('mousedown', stopMailOpen, true);

    button.addEventListener('click', async (event) => {
      stopMailOpen(event);

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

  function findMessageToolbar() {
    const candidates = [
      '[gh="mtb"]',
      'div[role="toolbar"]'
    ];

    for (const selector of candidates) {
      for (const toolbar of document.querySelectorAll(selector)) {
        if (toolbar.closest('tr.zA')) continue;
        const rect = toolbar.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return toolbar;
      }
    }

    return null;
  }

  function enhanceOpenMessage() {
    const subject = getOpenMailSubject();

    if (!subject) {
      document.getElementById(TOOLBAR_ID)?.remove();
      return;
    }

    if (document.getElementById(TOOLBAR_ID)) return;

    const toolbar = findMessageToolbar();
    if (!toolbar) return;

    const group = createActionGroup('', getOpenMailSubject);
    group.id = TOOLBAR_ID;
    toolbar.appendChild(group);
  }

  let refreshTimer = null;

  function scheduleRefresh() {
    if (refreshTimer) return;

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      injectStyles();
      enhanceMailRows();
      enhanceOpenMessage();
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
