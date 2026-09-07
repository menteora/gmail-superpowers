// ==UserScript==
// @name         Gmail Superpowers
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.4.0
// @description  Portable Gmail links, local status notes, and local cases that group related conversations.
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

  const ROW_ACTIONS = 'gmail-superpowers-row-actions';
  const ROW_NOTE = 'gmail-superpowers-row-note';
  const ROW_CASE = 'gmail-superpowers-row-case';
  const OPEN_ACTIONS_ID = 'gmail-superpowers-open-actions';
  const NOTE_PANEL_ID = 'gmail-superpowers-note-panel';
  const CASE_PANEL_ID = 'gmail-superpowers-case-panel';
  const CASE_PICKER_ID = 'gmail-superpowers-case-picker';
  const TOAST_ID = 'gmail-superpowers-toast';
  const STYLE_ID = 'gmail-superpowers-style';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const DB_NAME = 'gmail-superpowers';
  const DB_VERSION = 2;
  const NOTE_STORE = 'thread-notes';
  const CASE_STORE = 'cases';
  const MEMBER_STORE = 'case-members';

  let dbPromise = null;
  let cachePromise = null;
  let cache = emptyCache();
  let refreshTimer = null;

  const ICON_PATHS = {
    url: [
      'M10.59 13.41a2 2 0 0 0 2.82 0l4-4a2 2 0 1 0-2.82-2.82l-1.17 1.17a1 1 0 0 1-1.42-1.42l1.17-1.17a4 4 0 1 1 5.66 5.66l-4 4a4 4 0 0 1-5.66 0 1 1 0 0 1 1.42-1.42Z',
      'M13.41 10.59a2 2 0 0 0-2.82 0l-4 4a2 2 0 1 0 2.82 2.82l1.17-1.17A1 1 0 0 1 12 19.66l-1.17 1.17a4 4 0 1 1-5.66-5.66l4-4a4 4 0 0 1 5.66 0 1 1 0 1 1-1.42 1.42Z'
    ],
    markdown: [
      'M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h18V7H3Z',
      'M5 9h2l2 2.5L11 9h2v6h-2v-3.2l-2 2.4-2-2.4V15H5V9Zm10 0h2v3h2.2L17 15.2 14.8 12H17V9h2v1h2l-4 5.5L13 10h2V9Z'
    ],
    save: ['M9.55 17.45 4.8 12.7l1.4-1.4 3.35 3.35 8.25-8.25 1.4 1.4-9.65 9.65Z'],
    trash: ['M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm0-2h10V9H7v10Zm2-2h2v-6H9v6Zm4 0h2v-6h-2v6ZM4 5V3h5l1-1h4l1 1h5v2H4Z'],
    case: [
      'M7.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm9 9a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z',
      'M10.2 8.3 14 12.1l-1.4 1.4-3.8-3.8 1.4-1.4Z'
    ],
    close: ['M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z']
  };

  function emptyCache() {
    return {
      notesByKey: new Map(),
      notesBySubject: new Map(),
      casesById: new Map(),
      membersByKey: new Map(),
      membersBySubject: new Map(),
      membersByCase: new Map()
    };
  }

  function cleanText(value) {
    return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeSubject(value) {
    return cleanText(value).toLowerCase();
  }

  function getAccountScope() {
    const match = location.pathname.match(/\/mail\/u\/(\d+)\//);
    return match ? `u${match[1]}` : 'u-default';
  }

  function isLikelyThreadId(candidate) {
    const value = cleanText(candidate).replace(/^#/, '');
    if (!value || value.length < 8) return false;
    if (['inbox','sent','drafts','starred','important','all','spam','trash','search'].includes(value.toLowerCase())) return false;
    return !value.includes('%22') && !value.includes('%3a') && !value.includes(' ');
  }

  function getOpenThreadId() {
    const parts = (location.hash || '').split('/').filter(Boolean);
    const candidate = parts[parts.length - 1] || '';
    return isLikelyThreadId(candidate) ? candidate.replace(/^#/, '') : '';
  }

  function getRowThreadId(row) {
    const attrs = ['data-legacy-thread-id', 'data-thread-id', 'data-thread-perm-id'];
    for (const name of attrs) {
      const value = row.getAttribute(name);
      if (isLikelyThreadId(value)) return value.replace(/^#/, '');
    }
    const nested = row.querySelector('[data-legacy-thread-id], [data-thread-id], [data-thread-perm-id]');
    if (nested) {
      for (const name of attrs) {
        const value = nested.getAttribute(name);
        if (isLikelyThreadId(value)) return value.replace(/^#/, '');
      }
    }
    for (const link of row.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      if (!href.includes('#')) continue;
      const parts = href.slice(href.indexOf('#')).split('/').filter(Boolean);
      const candidate = parts[parts.length - 1] || '';
      if (isLikelyThreadId(candidate)) return candidate.replace(/^#/, '');
    }
    return '';
  }

  function buildEntityKey(subject, threadId = getOpenThreadId()) {
    const account = getAccountScope();
    return threadId ? `${account}:thread:${threadId}` : `${account}:subject:${normalizeSubject(subject)}`;
  }

  function findOpenMailSubjectElement() {
    for (const selector of ['h2.hP', '.ha h2', '[data-thread-perm-id] h2']) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (cleanText(element.textContent) && rect.width > 0 && rect.height > 0) return element;
      }
    }
    return null;
  }

  function getRowSubject(row) {
    const el = row.querySelector('span.bog') || row.querySelector('.y6 span') || row.querySelector('[data-thread-id] span');
    return cleanText(el?.textContent);
  }

  function findRowHost(row) {
    const subject = row.querySelector('span.bog');
    return subject ? (subject.closest('.y6') || subject.parentElement) : null;
  }

  function createSvgIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
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
      .${ROW_ACTIONS}{display:inline-flex;align-items:center;gap:2px;margin-left:7px;vertical-align:middle}
      .${ROW_NOTE},.${ROW_CASE}{display:inline-block;max-width:260px;margin-left:7px;padding:1px 7px;border-radius:10px;font:11px/18px Arial,sans-serif;vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
      .${ROW_NOTE}{background:rgba(251,188,4,.16);color:#5f4b00}
      .${ROW_CASE}{background:rgba(26,115,232,.12);color:#174ea6}
      .gsp-btn{border:0;border-radius:50%;background:transparent;color:#5f6368;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;position:relative;z-index:20;pointer-events:auto!important;width:30px;height:30px;padding:5px}
      .${ROW_ACTIONS} .gsp-btn{width:26px;height:26px;padding:4px}
      .gsp-btn:hover{background:rgba(60,64,67,.12);color:#202124}.gsp-btn:active{background:rgba(60,64,67,.20)}.gsp-btn[disabled]{opacity:.32;cursor:default;background:transparent}
      .gsp-btn svg{width:17px;height:17px;fill:currentColor;pointer-events:none}
      #${OPEN_ACTIONS_ID}{display:inline-flex;align-items:center;gap:2px;margin-left:8px;vertical-align:middle;position:relative;z-index:20;pointer-events:auto!important}
      #${NOTE_PANEL_ID},#${CASE_PANEL_ID},#${CASE_PICKER_ID}{display:flex;align-items:center;gap:6px;margin:6px 0 10px 0;min-height:34px;max-width:820px;position:relative;z-index:20;font-family:Arial,sans-serif}
      #${CASE_PANEL_ID},#${CASE_PICKER_ID}{align-items:flex-start;padding:8px 10px;border:1px solid #dadce0;border-radius:10px;background:#fff;flex-wrap:wrap}
      .gsp-label{flex:0 0 auto;font-size:12px;font-weight:600;color:#5f6368;line-height:32px}
      .gsp-input{flex:1 1 auto;min-width:140px;height:32px;padding:5px 10px;border:1px solid #dadce0;border-radius:8px;outline:none;background:#fff;color:#202124;font:13px/20px Arial,sans-serif;box-sizing:border-box;pointer-events:auto!important}
      .gsp-input:focus{border-color:#1a73e8;box-shadow:0 0 0 1px #1a73e8}
      .gsp-case-title{font-size:13px;font-weight:600;color:#202124;line-height:30px}.gsp-case-status{flex:1 1 260px}.gsp-members{width:100%;margin:2px 0 0 0;padding-left:20px;font:12px/20px Arial,sans-serif;color:#3c4043}.gsp-members a{color:#1a73e8;text-decoration:none}.gsp-members a:hover{text-decoration:underline}
      .gsp-picker-list{display:flex;flex-wrap:wrap;gap:6px;width:100%}.gsp-case-choice{border:1px solid #dadce0;border-radius:14px;background:#fff;padding:4px 9px;font:12px Arial,sans-serif;cursor:pointer}.gsp-case-choice:hover{background:#f1f3f4}
      .gsp-picker-new{display:flex;gap:6px;width:100%;align-items:center}.gsp-picker-new .gsp-input{max-width:420px}.gsp-muted{font:11px/16px Arial,sans-serif;color:#80868b;width:100%}
    `;
    document.head.appendChild(style);
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

  function makeButton(kind, title, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gsp-btn';
    button.appendChild(createSvgIcon(kind));
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('pointerdown', stopPropagationOnly, true);
    button.addEventListener('mousedown', stopPropagationOnly, true);
    button.addEventListener('click', async (event) => {
      stopAction(event);
      if (!button.disabled) await handler(button);
    }, true);
    return button;
  }

  function escapeGmailSearchValue(value) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function escapeMarkdownLabel(value) {
    return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  }

  function buildGmailSearch(subject) {
    const query = `subject:"${escapeGmailSearchValue(subject)}"`;
    const url = `https://mail.google.com/mail/#search/${encodeURIComponent(query)}`;
    return { url, markdown: `[email: ${escapeMarkdownLabel(subject)}](${url})` };
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') return GM_setClipboard(text, 'text');
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
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
    Object.assign(toast.style, {position:'fixed',right:'24px',bottom:'24px',zIndex:'2147483647',maxWidth:'440px',padding:'10px 14px',borderRadius:'8px',background:isError?'#b3261e':'#202124',color:'#fff',font:'13px/1.4 Arial,sans-serif',boxShadow:'0 4px 18px rgba(0,0,0,.25)'});
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(NOTE_STORE)) db.createObjectStore(NOTE_STORE, {keyPath:'key'});
        if (!db.objectStoreNames.contains(CASE_STORE)) db.createObjectStore(CASE_STORE, {keyPath:'id'});
        if (!db.objectStoreNames.contains(MEMBER_STORE)) {
          const store = db.createObjectStore(MEMBER_STORE, {keyPath:'memberKey'});
          store.createIndex('groupId', 'groupId', {unique:false});
        } else {
          const store = request.transaction.objectStore(MEMBER_STORE);
          if (!store.indexNames.contains('groupId')) store.createIndex('groupId', 'groupId', {unique:false});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB non disponibile'));
    });
    return dbPromise;
  }

  async function storeGet(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function storeGetAll(storeName) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function storePut(storeName, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async function storeDelete(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function invalidateCache() {
    cachePromise = null;
  }

  async function loadCache(force = false) {
    if (force) invalidateCache();
    if (cachePromise) return cachePromise;
    cachePromise = (async () => {
      const [notes, cases, members] = await Promise.all([storeGetAll(NOTE_STORE), storeGetAll(CASE_STORE), storeGetAll(MEMBER_STORE)]);
      const account = getAccountScope();
      const next = emptyCache();
      for (const record of notes) {
        if (!record?.key?.startsWith(`${account}:`) || !cleanText(record.text)) continue;
        next.notesByKey.set(record.key, record);
        const s = normalizeSubject(record.subject);
        if (s) next.notesBySubject.set(s, [...(next.notesBySubject.get(s) || []), record]);
      }
      for (const record of cases) {
        if (record?.account === account) next.casesById.set(record.id, record);
      }
      for (const record of members) {
        if (record?.account !== account) continue;
        next.membersByKey.set(record.memberKey, record);
        const s = normalizeSubject(record.subject);
        if (s) next.membersBySubject.set(s, [...(next.membersBySubject.get(s) || []), record]);
        next.membersByCase.set(record.groupId, [...(next.membersByCase.get(record.groupId) || []), record]);
      }
      cache = next;
    })();
    try { await cachePromise; } catch (error) { cachePromise = null; throw error; }
    return cachePromise;
  }

  async function saveNote(key, subject, text) {
    const value = cleanText(text);
    if (!value) return storeDelete(NOTE_STORE, key);
    return storePut(NOTE_STORE, {key, subject, text:value, updatedAt:new Date().toISOString()});
  }

  function newCaseId() {
    return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  async function createCase(name) {
    const value = cleanText(name);
    if (!value) throw new Error('Nome caso vuoto');
    const now = new Date().toISOString();
    const record = {id:newCaseId(), account:getAccountScope(), name:value, status:'', createdAt:now, updatedAt:now};
    await storePut(CASE_STORE, record);
    return record;
  }

  async function saveCaseStatus(group, status) {
    const next = {...group, status:cleanText(status), updatedAt:new Date().toISOString()};
    await storePut(CASE_STORE, next);
    return next;
  }

  function currentConversation(subject) {
    const threadId = getOpenThreadId();
    return {
      memberKey: buildEntityKey(subject, threadId),
      account: getAccountScope(),
      threadId,
      subject,
      url: location.href,
      updatedAt: new Date().toISOString()
    };
  }

  async function linkCurrentConversation(groupId, subject) {
    const current = currentConversation(subject);
    const previous = findBySubjectUnique(cache.membersBySubject, subject);
    if (previous && previous.memberKey !== current.memberKey) {
      await storeDelete(MEMBER_STORE, previous.memberKey);
    }
    await storePut(MEMBER_STORE, {...current, groupId});
  }

  async function unlinkMembership(memberKey) {
    await storeDelete(MEMBER_STORE, memberKey);
  }

  function findBySubjectUnique(map, subject) {
    const bucket = map.get(normalizeSubject(subject)) || [];
    return bucket.length === 1 ? bucket[0] : null;
  }

  function findNoteForRow(row, subject) {
    const threadId = getRowThreadId(row);
    const exact = threadId ? cache.notesByKey.get(buildEntityKey(subject, threadId)) : null;
    return exact || findBySubjectUnique(cache.notesBySubject, subject);
  }

  function findMemberForRow(row, subject) {
    const threadId = getRowThreadId(row);
    const exact = threadId ? cache.membersByKey.get(buildEntityKey(subject, threadId)) : null;
    return exact || findBySubjectUnique(cache.membersBySubject, subject);
  }

  function renderChip(row, className, text, title) {
    const existing = row.querySelector(`.${className}`);
    if (!text) { existing?.remove(); return; }
    const host = findRowHost(row);
    if (!host) return;
    const chip = existing || document.createElement('span');
    chip.className = className;
    if (chip.textContent !== text) chip.textContent = text;
    const nextTitle = title || text;
    if (chip.title !== nextTitle) chip.title = nextTitle;
    if (!existing) {
      const actions = host.querySelector(`.${ROW_ACTIONS}`);
      if (actions) host.insertBefore(chip, actions); else host.appendChild(chip);
    }
  }

  function enhanceMailRow(row) {
    const subject = getRowSubject(row);
    const host = subject && findRowHost(row);
    if (!host) return;
    if (!row.querySelector(`.${ROW_ACTIONS}`)) {
      const actions = document.createElement('span');
      actions.className = ROW_ACTIONS;
      actions.appendChild(makeCopyButton('url', () => getRowSubject(row)));
      actions.appendChild(makeCopyButton('markdown', () => getRowSubject(row)));
      host.appendChild(actions);
    }
  }

  function makeCopyButton(kind, getSubject) {
    const isMd = kind === 'markdown';
    return makeButton(kind, isMd ? 'Copia Gmail Search in Markdown' : 'Copia URL Gmail Search', async () => {
      const subject = cleanText(getSubject());
      if (!subject) return showToast('Oggetto email non trovato.', true);
      const search = buildGmailSearch(subject);
      try {
        await copyText(isMd ? search.markdown : search.url);
        showToast(isMd ? 'Markdown copiato' : 'URL Gmail Search copiato');
      } catch (error) {
        console.error('[Gmail Superpowers] Clipboard error:', error);
        showToast('Non riesco a copiare negli appunti.', true);
      }
    });
  }

  async function refreshRows(force = false) {
    try {
      await loadCache(force);
      for (const row of document.querySelectorAll('tr.zA')) {
        enhanceMailRow(row);
        const subject = getRowSubject(row);
        if (!subject) continue;
        const note = findNoteForRow(row, subject);
        renderChip(row, ROW_NOTE, cleanText(note?.text) ? `Stato: ${cleanText(note.text)}` : '', cleanText(note?.text));
        const member = findMemberForRow(row, subject);
        const group = member ? cache.casesById.get(member.groupId) : null;
        const caseText = group ? `Caso: ${group.name}${cleanText(group.status) ? ` · ${cleanText(group.status)}` : ''}` : '';
        renderChip(row, ROW_CASE, caseText, caseText);
      }
    } catch (error) {
      console.error('[Gmail Superpowers] Row refresh error:', error);
    }
  }

  function enhanceOpenActions() {
    const subjectEl = findOpenMailSubjectElement();
    if (!subjectEl) { document.getElementById(OPEN_ACTIONS_ID)?.remove(); return; }
    const existing = document.getElementById(OPEN_ACTIONS_ID);
    if (existing?.previousElementSibling === subjectEl) return;
    existing?.remove();
    const actions = document.createElement('span');
    actions.id = OPEN_ACTIONS_ID;
    actions.appendChild(makeCopyButton('url', () => cleanText(subjectEl.textContent)));
    actions.appendChild(makeCopyButton('markdown', () => cleanText(subjectEl.textContent)));
    actions.appendChild(makeButton('case', 'Collega questa conversazione a un caso', async () => {
      await toggleCasePicker(subjectEl);
    }));
    subjectEl.insertAdjacentElement('afterend', actions);
  }

  function createTextInput(placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gsp-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.addEventListener('pointerdown', stopPropagationOnly, true);
    input.addEventListener('mousedown', stopPropagationOnly, true);
    input.addEventListener('click', stopPropagationOnly, true);
    return input;
  }

  function getOpenSubjectHost(subjectEl) {
    return subjectEl.closest('.ha') || subjectEl.parentElement;
  }

  async function enhanceOpenNote() {
    const subjectEl = findOpenMailSubjectElement();
    if (!subjectEl) { document.getElementById(NOTE_PANEL_ID)?.remove(); return; }
    const subject = cleanText(subjectEl.textContent);
    const key = buildEntityKey(subject);
    const existing = document.getElementById(NOTE_PANEL_ID);
    if (existing?.dataset.key === key) return;
    existing?.remove();

    const panel = document.createElement('div');
    panel.id = NOTE_PANEL_ID;
    panel.dataset.key = key;
    const label = document.createElement('span');
    label.className = 'gsp-label';
    label.textContent = 'Stato';
    const input = createTextInput('Es. Aspetto risposta da X e Y');
    input.dataset.saved = '';

    async function persist(showMessage) {
      const value = cleanText(input.value);
      if (value === (input.dataset.saved || '')) return;
      try {
        await saveNote(key, subject, value);
        input.value = value;
        input.dataset.saved = value;
        deleteBtn.disabled = !value;
        invalidateCache();
        void refreshRows(true);
        if (showMessage) showToast(value ? 'Stato salvato' : 'Stato eliminato');
      } catch (error) {
        console.error('[Gmail Superpowers] Note save error:', error);
        showToast('Non riesco a salvare lo stato.', true);
      }
    }

    const saveBtn = makeButton('save', 'Salva stato', () => persist(true));
    const deleteBtn = makeButton('trash', 'Cancella stato', async () => {
      await storeDelete(NOTE_STORE, key);
      input.value = '';
      input.dataset.saved = '';
      deleteBtn.disabled = true;
      invalidateCache();
      void refreshRows(true);
      showToast('Stato eliminato');
    });
    deleteBtn.disabled = true;
    input.addEventListener('keydown', async (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); await persist(true); input.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); input.value = input.dataset.saved || ''; input.blur(); }
    });
    input.addEventListener('blur', () => persist(false));
    panel.append(label, input, saveBtn, deleteBtn);
    const host = getOpenSubjectHost(subjectEl);
    if (!host) return;
    host.insertAdjacentElement('afterend', panel);
    try {
      const record = await storeGet(NOTE_STORE, key);
      if (!document.contains(panel)) return;
      const value = cleanText(record?.text);
      input.value = value;
      input.dataset.saved = value;
      deleteBtn.disabled = !value;
    } catch (error) {
      console.error('[Gmail Superpowers] Note load error:', error);
    }
  }

  function memberNavigationUrl(member) {
    return member.url || buildGmailSearch(member.subject || '').url;
  }

  async function enhanceCasePanel(force = false) {
    const subjectEl = findOpenMailSubjectElement();
    if (!subjectEl) {
      document.getElementById(CASE_PANEL_ID)?.remove();
      document.getElementById(CASE_PICKER_ID)?.remove();
      return;
    }
    const subject = cleanText(subjectEl.textContent);
    const memberKey = buildEntityKey(subject);
    await loadCache(force);
    const membership = cache.membersByKey.get(memberKey) || findBySubjectUnique(cache.membersBySubject, subject);
    const group = membership ? cache.casesById.get(membership.groupId) : null;
    const existing = document.getElementById(CASE_PANEL_ID);
    if (!group) { existing?.remove(); return; }
    if (existing?.dataset.groupId === group.id && !force) return;
    existing?.remove();

    const panel = document.createElement('div');
    panel.id = CASE_PANEL_ID;
    panel.dataset.groupId = group.id;
    const title = document.createElement('span');
    title.className = 'gsp-case-title';
    title.textContent = `Caso: ${group.name}`;
    const status = createTextInput('Stato del caso');
    status.classList.add('gsp-case-status');
    status.value = cleanText(group.status);
    status.dataset.saved = status.value;

    async function persistStatus(showMessage) {
      const value = cleanText(status.value);
      if (value === (status.dataset.saved || '')) return;
      try {
        const updated = await saveCaseStatus(group, value);
        status.value = updated.status;
        status.dataset.saved = updated.status;
        invalidateCache();
        void refreshRows(true);
        if (showMessage) showToast('Stato del caso salvato');
      } catch (error) {
        console.error('[Gmail Superpowers] Case status error:', error);
        showToast('Non riesco a salvare lo stato del caso.', true);
      }
    }

    status.addEventListener('keydown', async (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); await persistStatus(true); status.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); status.value = status.dataset.saved || ''; status.blur(); }
    });
    status.addEventListener('blur', () => persistStatus(false));

    const manageBtn = makeButton('case', 'Cambia caso', () => toggleCasePicker(subjectEl, true));
    const unlinkBtn = makeButton('close', 'Scollega questa conversazione dal caso', async () => {
      try {
        await unlinkMembership(membership.memberKey);
        invalidateCache();
        document.getElementById(CASE_PICKER_ID)?.remove();
        await refreshAll(true);
        showToast('Conversazione scollegata dal caso');
      } catch (error) {
        console.error('[Gmail Superpowers] Unlink error:', error);
        showToast('Non riesco a scollegare la conversazione.', true);
      }
    });
    panel.append(title, status, manageBtn, unlinkBtn);

    const members = document.createElement('ul');
    members.className = 'gsp-members';
    for (const member of cache.membersByCase.get(group.id) || []) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = memberNavigationUrl(member);
      link.textContent = member.subject || 'Conversazione';
      link.title = member.subject || '';
      if (member.memberKey === memberKey) link.textContent += ' (questa)';
      li.appendChild(link);
      members.appendChild(li);
    }
    panel.appendChild(members);

    const notePanel = document.getElementById(NOTE_PANEL_ID);
    const host = notePanel || getOpenSubjectHost(subjectEl);
    if (host) host.insertAdjacentElement('afterend', panel);
  }

  async function toggleCasePicker(subjectEl, forceOpen = false) {
    const existing = document.getElementById(CASE_PICKER_ID);
    if (existing && !forceOpen) { existing.remove(); return; }
    existing?.remove();
    const subject = cleanText(subjectEl.textContent);
    await loadCache();

    const picker = document.createElement('div');
    picker.id = CASE_PICKER_ID;
    const label = document.createElement('span');
    label.className = 'gsp-label';
    label.textContent = 'Collega a caso';
    picker.appendChild(label);

    const list = document.createElement('div');
    list.className = 'gsp-picker-list';
    const groups = [...cache.casesById.values()].sort((a,b) => a.name.localeCompare(b.name));
    if (!groups.length) {
      const muted = document.createElement('div');
      muted.className = 'gsp-muted';
      muted.textContent = 'Nessun caso esistente. Creane uno qui sotto.';
      list.appendChild(muted);
    }
    for (const group of groups) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'gsp-case-choice';
      choice.textContent = group.name;
      choice.addEventListener('click', async (event) => {
        stopAction(event);
        try {
          await linkCurrentConversation(group.id, subject);
          picker.remove();
          invalidateCache();
          await refreshAll(true);
          showToast(`Collegata al caso: ${group.name}`);
        } catch (error) {
          console.error('[Gmail Superpowers] Link error:', error);
          showToast('Non riesco a collegare la conversazione.', true);
        }
      }, true);
      list.appendChild(choice);
    }
    picker.appendChild(list);

    const newRow = document.createElement('div');
    newRow.className = 'gsp-picker-new';
    const input = createTextInput('Nuovo caso, es. Preventivo Rossi');
    const addBtn = makeButton('save', 'Crea caso e collega', async () => {
      const name = cleanText(input.value);
      if (!name) { input.focus(); return; }
      try {
        const group = await createCase(name);
        await linkCurrentConversation(group.id, subject);
        picker.remove();
        invalidateCache();
        await refreshAll(true);
        showToast(`Caso creato: ${group.name}`);
      } catch (error) {
        console.error('[Gmail Superpowers] Create case error:', error);
        showToast('Non riesco a creare il caso.', true);
      }
    });
    input.addEventListener('keydown', async (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); addBtn.click(); }
      if (event.key === 'Escape') { event.preventDefault(); picker.remove(); }
    });
    newRow.append(input, addBtn);
    picker.appendChild(newRow);

    const panel = document.getElementById(CASE_PANEL_ID) || document.getElementById(NOTE_PANEL_ID) || getOpenSubjectHost(subjectEl);
    if (panel) panel.insertAdjacentElement('afterend', picker);
    input.focus();
  }

  async function refreshAll(force = false) {
    injectStyles();
    document.querySelectorAll('tr.zA').forEach(enhanceMailRow);
    await refreshRows(force);
    enhanceOpenActions();
    await enhanceOpenNote();
    await enhanceCasePanel(force);
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshAll(false);
    }, 120);
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  scheduleRefresh();
})();