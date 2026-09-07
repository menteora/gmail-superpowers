// ==UserScript==
// @name         Gmail Superpowers
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.1.0
// @description  Adds Gmail Search copy buttons inside and outside an open email.
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

  const FLOATING_BUTTON_ID = 'gmail-superpowers-search-floating';
  const TOOLBAR_BUTTON_ID = 'gmail-superpowers-search-toolbar';
  const TOAST_ID = 'gmail-superpowers-toast';

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
      const elements = document.querySelectorAll(selector);

      for (const element of elements) {
        const subject = cleanText(element.textContent);
        if (subject) return subject;
      }
    }

    return '';
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

    // Intentionally avoids /u/0/ and Gmail message/thread IDs.
    // Whoever opens the link searches the currently active/default Gmail mailbox.
    const url = `https://mail.google.com/mail/#search/${encodeURIComponent(query)}`;
    const markdown = `[email: ${escapeMarkdownLabel(subject)}](${url})`;

    return {
      query,
      url,
      markdown,
      clipboardText: `${url}\n${markdown}`
    };
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
      bottom: '78px',
      zIndex: '2147483647',
      maxWidth: '420px',
      padding: '10px 14px',
      borderRadius: '8px',
      background: isError ? '#b3261e' : '#202124',
      color: '#fff',
      font: '13px/1.4 Arial, sans-serif',
      boxShadow: '0 4px 18px rgba(0,0,0,.25)'
    });

    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3000);
  }

  async function copyCurrentMailSearch(event) {
    event?.preventDefault();
    event?.stopPropagation();

    const subject = getOpenMailSubject();

    if (!subject) {
      showToast('Apri una mail prima di copiare la Gmail Search.', true);
      return;
    }

    const search = buildGmailSearch(subject);

    try {
      await copyText(search.clipboardText);
      showToast(`Copiati URL + Markdown per: ${subject}`);
      console.debug('[Gmail Superpowers] Copied:', search);
    } catch (error) {
      console.error('[Gmail Superpowers] Clipboard error:', error);
      showToast('Non riesco a copiare negli appunti.', true);
    }
  }

  function createBaseButton(id, text) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = text;
    button.title = 'Copia Gmail Search come URL e Markdown';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', copyCurrentMailSearch);
    return button;
  }

  function ensureFloatingButton() {
    if (document.getElementById(FLOATING_BUTTON_ID)) return;

    const button = createBaseButton(FLOATING_BUTTON_ID, 'Gmail Search');

    Object.assign(button.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
      zIndex: '2147483646',
      height: '40px',
      padding: '0 16px',
      border: '0',
      borderRadius: '20px',
      background: '#1a73e8',
      color: '#fff',
      font: '600 13px Arial, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,.25)'
    });

    document.body.appendChild(button);
  }

  function findMessageToolbar() {
    const candidates = [
      '[gh="mtb"]',
      'div[role="toolbar"]'
    ];

    for (const selector of candidates) {
      const toolbars = document.querySelectorAll(selector);

      for (const toolbar of toolbars) {
        const rect = toolbar.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return toolbar;
      }
    }

    return null;
  }

  function ensureToolbarButton() {
    if (!getOpenMailSubject()) {
      document.getElementById(TOOLBAR_BUTTON_ID)?.remove();
      return;
    }

    if (document.getElementById(TOOLBAR_BUTTON_ID)) return;

    const toolbar = findMessageToolbar();
    if (!toolbar) return;

    const button = createBaseButton(TOOLBAR_BUTTON_ID, 'Gmail Search');

    Object.assign(button.style, {
      height: '32px',
      margin: '0 6px',
      padding: '0 12px',
      border: '1px solid #dadce0',
      borderRadius: '16px',
      background: '#fff',
      color: '#3c4043',
      font: '500 12px Arial, sans-serif',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    });

    toolbar.appendChild(button);
  }

  let refreshTimer = null;

  function scheduleRefresh() {
    if (refreshTimer) return;

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      ensureFloatingButton();
      ensureToolbarButton();
    }, 120);
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);

  ensureFloatingButton();
  scheduleRefresh();
})();
