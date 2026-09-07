// ==UserScript==
// @name         Gmail Superpowers
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.7.0
// @description  Portable Gmail links, local statuses, deadlines, cases, admin dashboard, Markdown export, and JSON backup/import.
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
  const ROW_DUE = 'gmail-superpowers-row-due';
  const OPEN_ACTIONS_ID = 'gmail-superpowers-open-actions';
  const NOTE_PANEL_ID = 'gmail-superpowers-note-panel';
  const DUE_PANEL_ID = 'gmail-superpowers-due-panel';
  const CASE_PANEL_ID = 'gmail-superpowers-case-panel';
  const CASE_PICKER_ID = 'gmail-superpowers-case-picker';
  const GLOBAL_TOOLS_ID = 'gmail-superpowers-global-tools';
  const ADMIN_ROOT_ID = 'gmail-superpowers-admin-root';
  const TOAST_ID = 'gmail-superpowers-toast';
  const STYLE_ID = 'gmail-superpowers-style';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const DB_NAME = 'gmail-superpowers';
  const DB_VERSION = 3;
  const NOTE_STORE = 'thread-notes';
  const DEADLINE_STORE = 'deadlines';
  const CASE_STORE = 'cases';
  const MEMBER_STORE = 'case-members';
  const BACKUP_FORMAT = 'gmail-superpowers-backup';
  const BACKUP_SCHEMA_VERSION = 1;

  let dbPromise = null;
  let cachePromise = null;
  let cache = emptyCache();
  let refreshTimer = null;
  let adminView = 'deadlines';
  let deadlineFilter = 'all';

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
    close: ['M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z'],
    calendar: ['M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3V2Zm13 8H4v10h16V10ZM4 8h16V6H4v2Z'],
    admin: ['M4 4h7v7H4V4Zm2 2v3h3V6H6Zm7-2h7v7h-7V4Zm2 2v3h3V6h-3ZM4 13h7v7H4v-7Zm2 2v3h3v-3H6Zm7-2h7v7h-7v-7Zm2 2v3h3v-3h-3Z']
  };

  function emptyCache() {
    return {
      notesByKey: new Map(),
      notesBySubject: new Map(),
      deadlinesByKey: new Map(),
      deadlinesBySubject: new Map(),
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

  function isAdminRoute() {
    return (location.hash || '').startsWith('#gsp-admin');
  }

  function adminUrl() {
    return `${location.origin}${location.pathname}#gsp-admin`;
  }

  function isLikelyThreadId(candidate) {
    const value = cleanText(candidate).replace(/^#/, '');
    if (!value || value.length < 8) return false;
    if (['inbox','sent','drafts','starred','important','all','spam','trash','search','gsp-admin'].includes(value.toLowerCase())) return false;
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
    const element = row.querySelector('span.bog') || row.querySelector('.y6 span') || row.querySelector('[data-thread-id] span');
    return cleanText(element?.textContent);
  }

  function findRowHost(row) {
    const subject = row.querySelector('span.bog');
    return subject ? (subject.closest('.y6') || subject.parentElement) : null;
  }

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
      .${ROW_ACTIONS}{display:inline-flex;align-items:center;gap:2px;margin-left:7px;vertical-align:middle}
      .${ROW_NOTE},.${ROW_CASE},.${ROW_DUE}{display:inline-block;max-width:260px;margin-left:7px;padding:1px 7px;border-radius:10px;font:11px/18px Arial,sans-serif;vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
      .${ROW_NOTE}{background:rgba(251,188,4,.16);color:#5f4b00}
      .${ROW_CASE}{background:rgba(26,115,232,.12);color:#174ea6}
      .${ROW_DUE}{background:rgba(52,168,83,.13);color:#137333}.gsp-due-overdue{background:rgba(217,48,37,.13)!important;color:#b3261e!important}.gsp-due-today{background:rgba(251,188,4,.22)!important;color:#7a5200!important}
      .gsp-btn{border:0;border-radius:50%;background:transparent;color:#5f6368;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;position:relative;z-index:20;pointer-events:auto!important;width:30px;height:30px;padding:5px}
      .${ROW_ACTIONS} .gsp-btn{width:26px;height:26px;padding:4px}.gsp-btn:hover{background:rgba(60,64,67,.12);color:#202124}.gsp-btn:active{background:rgba(60,64,67,.20)}.gsp-btn[disabled]{opacity:.32;cursor:default;background:transparent}.gsp-btn svg{width:17px;height:17px;fill:currentColor;pointer-events:none}
      #${OPEN_ACTIONS_ID}{display:inline-flex;align-items:center;gap:2px;margin-left:8px;vertical-align:middle;position:relative;z-index:20;pointer-events:auto!important}
      #${NOTE_PANEL_ID},#${DUE_PANEL_ID},#${CASE_PANEL_ID},#${CASE_PICKER_ID}{display:flex;align-items:center;gap:6px;margin:6px 0 10px;min-height:34px;max-width:820px;position:relative;z-index:20;font-family:Arial,sans-serif}
      #${CASE_PANEL_ID},#${CASE_PICKER_ID}{align-items:flex-start;padding:8px 10px;border:1px solid #dadce0;border-radius:10px;background:#fff;flex-wrap:wrap}
      .gsp-label{flex:0 0 auto;font-size:12px;font-weight:600;color:#5f6368;line-height:32px}.gsp-input{flex:1 1 auto;min-width:140px;height:32px;padding:5px 10px;border:1px solid #dadce0;border-radius:8px;outline:none;background:#fff;color:#202124;font:13px/20px Arial,sans-serif;box-sizing:border-box;pointer-events:auto!important}.gsp-input:focus{border-color:#1a73e8;box-shadow:0 0 0 1px #1a73e8}.gsp-date-input{flex:0 0 170px}
      .gsp-case-title{font-size:13px;font-weight:600;color:#202124;line-height:30px}.gsp-case-status{flex:1 1 260px}.gsp-members{width:100%;margin:2px 0 0;padding-left:20px;font:12px/20px Arial,sans-serif;color:#3c4043}.gsp-members a{color:#1a73e8;text-decoration:none}.gsp-members a:hover{text-decoration:underline}.gsp-member-meta{color:#80868b;margin-left:5px}
      .gsp-picker-list{display:flex;flex-wrap:wrap;gap:6px;width:100%}.gsp-case-choice{border:1px solid #dadce0;border-radius:14px;background:#fff;padding:4px 9px;font:12px Arial,sans-serif;cursor:pointer}.gsp-case-choice:hover{background:#f1f3f4}.gsp-picker-new{display:flex;gap:6px;width:100%;align-items:center}.gsp-picker-new .gsp-input{max-width:420px}.gsp-muted{font:11px/16px Arial,sans-serif;color:#80868b;width:100%}
      #${GLOBAL_TOOLS_ID}{position:fixed;right:24px;bottom:24px;z-index:2147483646;font-family:Arial,sans-serif;pointer-events:auto!important}.gsp-global-btn{height:36px;padding:0 14px 0 10px;border:1px solid #dadce0;border-radius:19px;background:#fff;color:#3c4043;box-shadow:0 2px 8px rgba(60,64,67,.18);cursor:pointer;display:flex;align-items:center;gap:7px;font:12px Arial,sans-serif}.gsp-global-btn:hover{background:#f8f9fa;box-shadow:0 3px 10px rgba(60,64,67,.24)}.gsp-global-btn svg{width:18px;height:18px;fill:currentColor;pointer-events:none}
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

  function escapeMarkdownText(value) {
    return cleanText(value).replace(/\\/g, '\\\\').replace(/([*_`#])/g, '\\$1').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  }

  function buildGmailSearch(subject) {
    const query = `subject:"${escapeGmailSearchValue(subject)}"`;
    const url = `https://mail.google.com/mail/#search/${encodeURIComponent(query)}`;
    return {url, markdown: `[email: ${escapeMarkdownLabel(subject)}](${url})`};
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
    if (!ok) throw new Error('Clipboard unavailable');
  }

  function showToast(message, isError = false) {
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed', right: '24px', bottom: '72px', zIndex: '2147483647', maxWidth: '440px',
      padding: '10px 14px', borderRadius: '8px', background: isError ? '#b3261e' : '#202124', color: '#fff',
      font: '13px/1.4 Arial,sans-serif', boxShadow: '0 4px 18px rgba(0,0,0,.25)'
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(NOTE_STORE)) db.createObjectStore(NOTE_STORE, {keyPath: 'key'});
        if (!db.objectStoreNames.contains(DEADLINE_STORE)) db.createObjectStore(DEADLINE_STORE, {keyPath: 'key'});
        if (!db.objectStoreNames.contains(CASE_STORE)) db.createObjectStore(CASE_STORE, {keyPath: 'id'});
        if (!db.objectStoreNames.contains(MEMBER_STORE)) {
          const store = db.createObjectStore(MEMBER_STORE, {keyPath: 'memberKey'});
          store.createIndex('groupId', 'groupId', {unique: false});
        } else {
          const store = request.transaction.objectStore(MEMBER_STORE);
          if (!store.indexNames.contains('groupId')) store.createIndex('groupId', 'groupId', {unique: false});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
    return dbPromise;
  }

  async function storeGet(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeGetAll(storeName) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function storePut(storeName, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeDelete(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function invalidateCache() {
    cachePromise = null;
  }

  async function loadCache(force = false) {
    if (force) invalidateCache();
    if (cachePromise) return cachePromise;
    cachePromise = (async () => {
      const [notes, deadlines, cases, members] = await Promise.all([
        storeGetAll(NOTE_STORE), storeGetAll(DEADLINE_STORE), storeGetAll(CASE_STORE), storeGetAll(MEMBER_STORE)
      ]);
      const account = getAccountScope();
      const next = emptyCache();

      for (const record of notes) {
        if (!record?.key?.startsWith(`${account}:`) || !cleanText(record.text)) continue;
        next.notesByKey.set(record.key, record);
        const subject = normalizeSubject(record.subject);
        if (subject) next.notesBySubject.set(subject, [...(next.notesBySubject.get(subject) || []), record]);
      }
      for (const record of deadlines) {
        if (!record?.key?.startsWith(`${account}:`) || !/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate || '')) continue;
        next.deadlinesByKey.set(record.key, record);
        const subject = normalizeSubject(record.subject);
        if (subject) next.deadlinesBySubject.set(subject, [...(next.deadlinesBySubject.get(subject) || []), record]);
      }
      for (const record of cases) {
        if (record?.account === account) next.casesById.set(record.id, record);
      }
      for (const record of members) {
        if (record?.account !== account) continue;
        next.membersByKey.set(record.memberKey, record);
        const subject = normalizeSubject(record.subject);
        if (subject) next.membersBySubject.set(subject, [...(next.membersBySubject.get(subject) || []), record]);
        next.membersByCase.set(record.groupId, [...(next.membersByCase.get(record.groupId) || []), record]);
      }
      cache = next;
    })();
    try {
      await cachePromise;
    } catch (error) {
      cachePromise = null;
      throw error;
    }
    return cachePromise;
  }

  async function saveNote(key, subject, text) {
    const value = cleanText(text);
    if (!value) return storeDelete(NOTE_STORE, key);
    return storePut(NOTE_STORE, {key, subject, text: value, updatedAt: new Date().toISOString()});
  }

  async function saveDeadline(key, subject, dueDate) {
    const value = cleanText(dueDate);
    if (!value) return storeDelete(DEADLINE_STORE, key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
    return storePut(DEADLINE_STORE, {key, subject, dueDate: value, updatedAt: new Date().toISOString()});
  }

  function newCaseId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function createCase(name) {
    const value = cleanText(name);
    if (!value) throw new Error('Empty case name');
    const now = new Date().toISOString();
    const record = {id: newCaseId(), account: getAccountScope(), name: value, status: '', createdAt: now, updatedAt: now};
    await storePut(CASE_STORE, record);
    return record;
  }

  async function saveCaseStatus(group, status) {
    const next = {...group, status: cleanText(status), updatedAt: new Date().toISOString()};
    await storePut(CASE_STORE, next);
    return next;
  }

  function extractLatestEmailFromOpenConversation() {
    const candidates = [...document.querySelectorAll('span.g3')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const element = candidates[candidates.length - 1];
    if (!element) return {lastEmailLabel: '', lastEmailAt: ''};
    const label = cleanText(element.getAttribute('title') || element.getAttribute('data-tooltip') || element.textContent);
    const parsed = Date.parse(label);
    return {lastEmailLabel: label, lastEmailAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''};
  }

  function extractLatestEmailFromRow(row) {
    const element = row.querySelector('td.xW span[title]') || row.querySelector('td.xW span') || row.querySelector('.xW span');
    if (!element) return {lastEmailLabel: '', lastEmailAt: ''};
    const label = cleanText(element.getAttribute('title') || element.textContent);
    const parsed = Date.parse(label);
    return {lastEmailLabel: label, lastEmailAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''};
  }

  function formatLatestEmail(member) {
    const iso = member?.lastEmailAt;
    if (iso) {
      const date = new Date(iso);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString('it-IT', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
      }
    }
    return cleanText(member?.lastEmailLabel);
  }

  function currentConversation(subject) {
    const threadId = getOpenThreadId();
    const latest = extractLatestEmailFromOpenConversation();
    return {
      memberKey: buildEntityKey(subject, threadId),
      account: getAccountScope(),
      threadId,
      subject,
      url: buildGmailSearch(subject).url,
      ...latest,
      updatedAt: new Date().toISOString()
    };
  }

  async function linkCurrentConversation(groupId, subject) {
    const current = currentConversation(subject);
    const previous = findBySubjectUnique(cache.membersBySubject, subject);
    if (previous && previous.memberKey !== current.memberKey) await storeDelete(MEMBER_STORE, previous.memberKey);
    await storePut(MEMBER_STORE, {...current, groupId});
  }

  async function unlinkMembership(memberKey) {
    await storeDelete(MEMBER_STORE, memberKey);
  }

  async function refreshOpenMemberTimestamp(membership) {
    if (!membership) return membership;
    const latest = extractLatestEmailFromOpenConversation();
    if (!latest.lastEmailLabel && !latest.lastEmailAt) return membership;
    if (latest.lastEmailLabel === cleanText(membership.lastEmailLabel) && latest.lastEmailAt === cleanText(membership.lastEmailAt)) return membership;
    const updated = {...membership, ...latest, updatedAt: new Date().toISOString()};
    await storePut(MEMBER_STORE, updated);
    invalidateCache();
    return updated;
  }

  function findBySubjectUnique(map, subject) {
    const bucket = map.get(normalizeSubject(subject)) || [];
    return bucket.length === 1 ? bucket[0] : null;
  }

  function findNoteForRow(row, subject) {
    const threadId = getRowThreadId(row);
    return (threadId ? cache.notesByKey.get(buildEntityKey(subject, threadId)) : null) || findBySubjectUnique(cache.notesBySubject, subject);
  }

  function findDeadlineForRow(row, subject) {
    const threadId = getRowThreadId(row);
    return (threadId ? cache.deadlinesByKey.get(buildEntityKey(subject, threadId)) : null) || findBySubjectUnique(cache.deadlinesBySubject, subject);
  }

  function findMemberForRow(row, subject) {
    const threadId = getRowThreadId(row);
    return (threadId ? cache.membersByKey.get(buildEntityKey(subject, threadId)) : null) || findBySubjectUnique(cache.membersBySubject, subject);
  }

  function findNoteForKey(key, subject) {
    return cache.notesByKey.get(key) || findBySubjectUnique(cache.notesBySubject, subject);
  }

  function findDeadlineForKey(key, subject) {
    return cache.deadlinesByKey.get(key) || findBySubjectUnique(cache.deadlinesBySubject, subject);
  }

  function findMemberForKey(key, subject) {
    return cache.membersByKey.get(key) || findBySubjectUnique(cache.membersBySubject, subject);
  }

  function findNoteForMember(member) {
    return findNoteForKey(member.memberKey, member.subject);
  }

  function findDeadlineForMember(member) {
    return findDeadlineForKey(member.memberKey, member.subject);
  }

  function findMemberForNote(note) {
    return findMemberForKey(note.key, note.subject);
  }

  function localDateIso(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDaysIso(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return localDateIso(date);
  }

  function formatDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
    return new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', {day: '2-digit', month: '2-digit', year: 'numeric'});
  }

  function dueClass(iso) {
    const today = localDateIso();
    if (iso < today) return 'overdue';
    if (iso === today) return 'today';
    return 'future';
  }

  function renderChip(row, className, text, title, extraClass = '') {
    const existing = row.querySelector(`.${className}`);
    if (!text) {
      existing?.remove();
      return;
    }
    const host = findRowHost(row);
    if (!host) return;
    const chip = existing || document.createElement('span');
    chip.className = `${className}${extraClass ? ` ${extraClass}` : ''}`;
    if (chip.textContent !== text) chip.textContent = text;
    chip.title = title || text;
    if (!existing) {
      const actions = host.querySelector(`.${ROW_ACTIONS}`);
      if (actions) host.insertBefore(chip, actions);
      else host.appendChild(chip);
    }
  }

  function makeCopyButton(kind, getSubject) {
    const isMarkdown = kind === 'markdown';
    return makeButton(kind, isMarkdown ? 'Copia Gmail Search in Markdown' : 'Copia URL Gmail Search', async () => {
      const subject = cleanText(getSubject());
      if (!subject) return showToast('Oggetto email non trovato.', true);
      const search = buildGmailSearch(subject);
      try {
        await copyText(isMarkdown ? search.markdown : search.url);
        showToast(isMarkdown ? 'Markdown copiato' : 'URL Gmail Search copiato');
      } catch (error) {
        console.error('[Gmail Superpowers] Clipboard error:', error);
        showToast('Non riesco a copiare negli appunti.', true);
      }
    });
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

  async function backfillMemberFromRow(row, member) {
    if (!member) return;
    const latest = extractLatestEmailFromRow(row);
    if (!latest.lastEmailLabel && !latest.lastEmailAt) return;
    if (latest.lastEmailLabel === cleanText(member.lastEmailLabel) && latest.lastEmailAt === cleanText(member.lastEmailAt)) return;
    try {
      await storePut(MEMBER_STORE, {...member, ...latest, updatedAt: new Date().toISOString()});
      invalidateCache();
    } catch (error) {
      console.debug('[Gmail Superpowers] Row timestamp backfill failed:', error);
    }
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

        const deadline = findDeadlineForRow(row, subject);
        const due = cleanText(deadline?.dueDate);
        renderChip(row, ROW_DUE, due ? `Scade: ${formatDate(due)}` : '', due ? `Scadenza: ${formatDate(due)}` : '', due ? `gsp-due-${dueClass(due)}` : '');

        const member = findMemberForRow(row, subject);
        const group = member ? cache.casesById.get(member.groupId) : null;
        const caseText = group ? `Caso: ${group.name}${cleanText(group.status) ? ` - ${cleanText(group.status)}` : ''}` : '';
        renderChip(row, ROW_CASE, caseText, caseText);
        if (member) void backfillMemberFromRow(row, member);
      }
    } catch (error) {
      console.error('[Gmail Superpowers] Row refresh error:', error);
    }
  }

  function enhanceOpenActions() {
    const subjectElement = findOpenMailSubjectElement();
    if (!subjectElement) {
      document.getElementById(OPEN_ACTIONS_ID)?.remove();
      return;
    }
    const existing = document.getElementById(OPEN_ACTIONS_ID);
    if (existing?.previousElementSibling === subjectElement) return;
    existing?.remove();

    const actions = document.createElement('span');
    actions.id = OPEN_ACTIONS_ID;
    actions.appendChild(makeCopyButton('url', () => cleanText(subjectElement.textContent)));
    actions.appendChild(makeCopyButton('markdown', () => cleanText(subjectElement.textContent)));
    actions.appendChild(makeButton('case', 'Collega questa conversazione a un caso', async () => toggleCasePicker(subjectElement)));
    subjectElement.insertAdjacentElement('afterend', actions);
  }

  function createTextInput(placeholder, type = 'text') {
    const input = document.createElement('input');
    input.type = type;
    input.className = 'gsp-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.addEventListener('pointerdown', stopPropagationOnly, true);
    input.addEventListener('mousedown', stopPropagationOnly, true);
    input.addEventListener('click', stopPropagationOnly, true);
    return input;
  }

  function getOpenSubjectHost(subjectElement) {
    return subjectElement.closest('.ha') || subjectElement.parentElement;
  }

  async function enhanceOpenNote() {
    const subjectElement = findOpenMailSubjectElement();
    if (!subjectElement) {
      document.getElementById(NOTE_PANEL_ID)?.remove();
      return;
    }
    const subject = cleanText(subjectElement.textContent);
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
        deleteButton.disabled = !value;
        invalidateCache();
        void refreshRows(true);
        if (showMessage) showToast(value ? 'Stato salvato' : 'Stato eliminato');
      } catch (error) {
        console.error('[Gmail Superpowers] Note save error:', error);
        showToast('Non riesco a salvare lo stato.', true);
      }
    }

    const saveButton = makeButton('save', 'Salva stato', () => persist(true));
    const deleteButton = makeButton('trash', 'Cancella stato', async () => {
      await storeDelete(NOTE_STORE, key);
      input.value = '';
      input.dataset.saved = '';
      deleteButton.disabled = true;
      invalidateCache();
      void refreshRows(true);
      showToast('Stato eliminato');
    });
    deleteButton.disabled = true;

    input.addEventListener('keydown', async (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        await persist(true);
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = input.dataset.saved || '';
        input.blur();
      }
    });
    input.addEventListener('blur', () => persist(false));
    panel.append(label, input, saveButton, deleteButton);

    const host = getOpenSubjectHost(subjectElement);
    if (!host) return;
    host.insertAdjacentElement('afterend', panel);
    try {
      const record = await storeGet(NOTE_STORE, key);
      if (!document.contains(panel)) return;
      const value = cleanText(record?.text);
      input.value = value;
      input.dataset.saved = value;
      deleteButton.disabled = !value;
    } catch (error) {
      console.error('[Gmail Superpowers] Note load error:', error);
    }
  }

  async function enhanceOpenDeadline() {
    const subjectElement = findOpenMailSubjectElement();
    if (!subjectElement) {
      document.getElementById(DUE_PANEL_ID)?.remove();
      return;
    }
    const subject = cleanText(subjectElement.textContent);
    const key = buildEntityKey(subject);
    const existing = document.getElementById(DUE_PANEL_ID);
    if (existing?.dataset.key === key) return;
    existing?.remove();

    const panel = document.createElement('div');
    panel.id = DUE_PANEL_ID;
    panel.dataset.key = key;
    const label = document.createElement('span');
    label.className = 'gsp-label';
    label.textContent = 'Scadenza';
    const input = createTextInput('', 'date');
    input.classList.add('gsp-date-input');
    input.dataset.saved = '';

    async function persist(showMessage) {
      const value = input.value || '';
      if (value === (input.dataset.saved || '')) return;
      try {
        await saveDeadline(key, subject, value);
        input.dataset.saved = value;
        clearButton.disabled = !value;
        invalidateCache();
        void refreshRows(true);
        if (showMessage) showToast(value ? 'Scadenza salvata' : 'Scadenza rimossa');
      } catch (error) {
        console.error('[Gmail Superpowers] Deadline save error:', error);
        showToast('Non riesco a salvare la scadenza.', true);
      }
    }

    const saveButton = makeButton('save', 'Salva scadenza', () => persist(true));
    const clearButton = makeButton('trash', 'Rimuovi scadenza', async () => {
      await storeDelete(DEADLINE_STORE, key);
      input.value = '';
      input.dataset.saved = '';
      clearButton.disabled = true;
      invalidateCache();
      void refreshRows(true);
      showToast('Scadenza rimossa');
    });
    clearButton.disabled = true;

    input.addEventListener('change', () => persist(false));
    input.addEventListener('keydown', async (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        await persist(true);
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = input.dataset.saved || '';
        input.blur();
      }
    });

    panel.append(label, input, saveButton, clearButton);
    const notePanel = document.getElementById(NOTE_PANEL_ID);
    const host = notePanel || getOpenSubjectHost(subjectElement);
    if (!host) return;
    host.insertAdjacentElement('afterend', panel);
    try {
      const record = await storeGet(DEADLINE_STORE, key);
      if (!document.contains(panel)) return;
      const value = cleanText(record?.dueDate);
      input.value = value;
      input.dataset.saved = value;
      clearButton.disabled = !value;
    } catch (error) {
      console.error('[Gmail Superpowers] Deadline load error:', error);
    }
  }

  function memberNavigationUrl(member) {
    return buildGmailSearch(member.subject || '').url;
  }

  async function enhanceCasePanel(force = false) {
    const subjectElement = findOpenMailSubjectElement();
    if (!subjectElement) {
      document.getElementById(CASE_PANEL_ID)?.remove();
      document.getElementById(CASE_PICKER_ID)?.remove();
      return;
    }
    const subject = cleanText(subjectElement.textContent);
    const memberKey = buildEntityKey(subject);
    await loadCache(force);
    let membership = cache.membersByKey.get(memberKey) || findBySubjectUnique(cache.membersBySubject, subject);
    const group = membership ? cache.casesById.get(membership.groupId) : null;
    const existing = document.getElementById(CASE_PANEL_ID);
    if (!group) {
      existing?.remove();
      return;
    }

    membership = await refreshOpenMemberTimestamp(membership);
    if (cachePromise === null) await loadCache(true);
    const freshMembership = cache.membersByKey.get(membership.memberKey) || membership;

    if (existing?.dataset.groupId === group.id && existing?.dataset.memberKey === freshMembership.memberKey && !force) return;
    existing?.remove();

    const panel = document.createElement('div');
    panel.id = CASE_PANEL_ID;
    panel.dataset.groupId = group.id;
    panel.dataset.memberKey = freshMembership.memberKey;

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
      if (event.key === 'Enter') {
        event.preventDefault();
        await persistStatus(true);
        status.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        status.value = status.dataset.saved || '';
        status.blur();
      }
    });
    status.addEventListener('blur', () => persistStatus(false));

    const manageButton = makeButton('case', 'Cambia caso', () => toggleCasePicker(subjectElement, true));
    const unlinkButton = makeButton('close', 'Scollega questa conversazione dal caso', async () => {
      try {
        await unlinkMembership(freshMembership.memberKey);
        invalidateCache();
        document.getElementById(CASE_PICKER_ID)?.remove();
        await refreshAll(true);
        showToast('Conversazione scollegata dal caso');
      } catch (error) {
        console.error('[Gmail Superpowers] Unlink error:', error);
        showToast('Non riesco a scollegare la conversazione.', true);
      }
    });
    panel.append(title, status, manageButton, unlinkButton);

    const members = document.createElement('ul');
    members.className = 'gsp-members';
    for (const member of cache.membersByCase.get(group.id) || []) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = memberNavigationUrl(member);
      link.textContent = member.subject || 'Conversazione';
      link.title = member.subject || '';
      if (member.memberKey === freshMembership.memberKey) link.textContent += ' (questa)';
      item.appendChild(link);

      const metaParts = [];
      const latest = formatLatestEmail(member);
      if (latest) metaParts.push(`ultima email ${latest}`);
      const due = findDeadlineForMember(member);
      if (due?.dueDate) metaParts.push(`scade ${formatDate(due.dueDate)}`);
      if (metaParts.length) {
        const meta = document.createElement('span');
        meta.className = 'gsp-member-meta';
        meta.textContent = ` - ${metaParts.join(' - ')}`;
        item.appendChild(meta);
      }
      members.appendChild(item);
    }
    panel.appendChild(members);

    const duePanel = document.getElementById(DUE_PANEL_ID);
    const notePanel = document.getElementById(NOTE_PANEL_ID);
    const host = duePanel || notePanel || getOpenSubjectHost(subjectElement);
    if (host) host.insertAdjacentElement('afterend', panel);
  }

  async function toggleCasePicker(subjectElement, forceOpen = false) {
    const existing = document.getElementById(CASE_PICKER_ID);
    if (existing && !forceOpen) {
      existing.remove();
      return;
    }
    existing?.remove();
    const subject = cleanText(subjectElement.textContent);
    await loadCache();

    const picker = document.createElement('div');
    picker.id = CASE_PICKER_ID;
    const label = document.createElement('span');
    label.className = 'gsp-label';
    label.textContent = 'Collega a caso';
    picker.appendChild(label);

    const list = document.createElement('div');
    list.className = 'gsp-picker-list';
    const groups = [...cache.casesById.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
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
    const addButton = makeButton('save', 'Crea caso e collega', async () => {
      const name = cleanText(input.value);
      if (!name) {
        input.focus();
        return;
      }
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
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        addButton.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        picker.remove();
      }
    });
    newRow.append(input, addButton);
    picker.appendChild(newRow);

    const panel = document.getElementById(CASE_PANEL_ID) || document.getElementById(DUE_PANEL_ID) || document.getElementById(NOTE_PANEL_ID) || getOpenSubjectHost(subjectElement);
    if (panel) panel.insertAdjacentElement('afterend', picker);
    input.focus();
  }

  function getUngroupedNotes() {
    return [...cache.notesByKey.values()]
      .filter((note) => {
        const member = findMemberForNote(note);
        return !member || !cache.casesById.has(member.groupId);
      })
      .sort((a, b) => cleanText(a.subject).localeCompare(cleanText(b.subject), 'it'));
  }

  function allDeadlinesSorted() {
    return [...cache.deadlinesByKey.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || cleanText(a.subject).localeCompare(cleanText(b.subject), 'it'));
  }

  function buildMarkdownExport() {
    const lines = [];
    const groups = [...cache.casesById.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    lines.push('# Gmail Superpowers', '', `Esportato: ${new Date().toLocaleString('it-IT')}`, '', '## Casi', '');
    if (!groups.length) lines.push('_Nessun caso._', '');

    for (const group of groups) {
      lines.push(`### ${escapeMarkdownText(group.name)}`, '', `Stato: ${cleanText(group.status) ? escapeMarkdownText(group.status) : '-'}`, '', 'Conversazioni:');
      const members = [...(cache.membersByCase.get(group.id) || [])].sort((a, b) => cleanText(a.subject).localeCompare(cleanText(b.subject), 'it'));
      if (!members.length) lines.push('- _Nessuna conversazione collegata_');
      for (const member of members) {
        const subject = cleanText(member.subject) || 'Conversazione senza oggetto';
        lines.push(`- ${buildGmailSearch(subject).markdown}`);
        const latest = formatLatestEmail(member);
        if (latest) lines.push(`  - Ultima email: ${escapeMarkdownText(latest)}`);
        const note = findNoteForMember(member);
        const due = findDeadlineForMember(member);
        if (cleanText(note?.text)) lines.push(`  - Stato: ${escapeMarkdownText(note.text)}`);
        if (due?.dueDate) lines.push(`  - Scadenza: ${due.dueDate}`);
      }
      lines.push('');
    }

    lines.push('## Conversazioni con stato senza caso', '');
    const ungrouped = getUngroupedNotes();
    if (!ungrouped.length) lines.push('_Nessuna._');
    else {
      for (const note of ungrouped) {
        const subject = cleanText(note.subject) || 'Conversazione senza oggetto';
        lines.push(`- ${buildGmailSearch(subject).markdown}`, `  - Stato: ${escapeMarkdownText(note.text)}`);
        const due = findDeadlineForKey(note.key, note.subject);
        if (due?.dueDate) lines.push(`  - Scadenza: ${due.dueDate}`);
      }
    }

    lines.push('', '## Scadenze', '');
    const deadlines = allDeadlinesSorted();
    if (!deadlines.length) lines.push('_Nessuna scadenza._');
    else {
      for (const due of deadlines) {
        const subject = cleanText(due.subject) || 'Conversazione senza oggetto';
        lines.push(`- ${due.dueDate} - ${buildGmailSearch(subject).markdown}`);
        const note = findNoteForKey(due.key, due.subject);
        if (note?.text) lines.push(`  - Stato: ${escapeMarkdownText(note.text)}`);
        const member = findMemberForKey(due.key, due.subject);
        const group = member ? cache.casesById.get(member.groupId) : null;
        if (group) lines.push(`  - Caso: ${escapeMarkdownText(group.name)}`);
      }
    }
    return `${lines.join('\n').trim()}\n`;
  }

  function downloadTextFile(content, filename, mime) {
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadMarkdown(markdown) {
    downloadTextFile(markdown, `gmail-superpowers-${localDateIso()}.md`, 'text/markdown;charset=utf-8');
  }

  function buildJsonBackup() {
    return {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '0.7.0',
      exportedAt: new Date().toISOString(),
      sourceAccount: getAccountScope(),
      data: {
        notes: [...cache.notesByKey.values()],
        deadlines: [...cache.deadlinesByKey.values()],
        cases: [...cache.casesById.values()],
        members: [...cache.membersByKey.values()]
      }
    };
  }

  function downloadJsonBackup() {
    const content = `${JSON.stringify(buildJsonBackup(), null, 2)}\n`;
    downloadTextFile(content, `gmail-superpowers-backup-${localDateIso()}.json`, 'application/json;charset=utf-8');
  }

  function validateBackup(payload) {
    if (!payload || payload.format !== BACKUP_FORMAT) throw new Error('File non riconosciuto');
    if (payload.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error(`Schema backup non supportato: ${payload.schemaVersion}`);
    if (!payload.data || !Array.isArray(payload.data.notes) || !Array.isArray(payload.data.deadlines) || !Array.isArray(payload.data.cases) || !Array.isArray(payload.data.members)) {
      throw new Error('Backup incompleto o non valido');
    }
    return payload;
  }

  function rebaseStorageKey(key, sourceAccount, targetAccount) {
    const value = cleanText(key);
    if (!value) return '';
    if (sourceAccount && value.startsWith(`${sourceAccount}:`)) return `${targetAccount}:${value.slice(sourceAccount.length + 1)}`;
    const match = value.match(/^u(?:\d+|-default):(.*)$/);
    return match ? `${targetAccount}:${match[1]}` : value;
  }

  function normalizeImportedNote(record, sourceAccount, targetAccount) {
    const key = rebaseStorageKey(record?.key, sourceAccount, targetAccount);
    const subject = cleanText(record?.subject);
    const text = cleanText(record?.text);
    if (!key || !subject || !text) return null;
    return {key, subject, text, updatedAt: record.updatedAt || new Date().toISOString()};
  }

  function normalizeImportedDeadline(record, sourceAccount, targetAccount) {
    const key = rebaseStorageKey(record?.key, sourceAccount, targetAccount);
    const subject = cleanText(record?.subject);
    const dueDate = cleanText(record?.dueDate);
    if (!key || !subject || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
    return {key, subject, dueDate, updatedAt: record.updatedAt || new Date().toISOString()};
  }

  function normalizeImportedCase(record, targetAccount) {
    const id = cleanText(record?.id);
    const name = cleanText(record?.name);
    if (!id || !name) return null;
    return {
      id,
      account: targetAccount,
      name,
      status: cleanText(record.status),
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString()
    };
  }

  function normalizeImportedMember(record, sourceAccount, targetAccount) {
    const memberKey = rebaseStorageKey(record?.memberKey, sourceAccount, targetAccount);
    const subject = cleanText(record?.subject);
    const groupId = cleanText(record?.groupId);
    if (!memberKey || !subject || !groupId) return null;
    return {
      memberKey,
      account: targetAccount,
      threadId: cleanText(record.threadId),
      subject,
      groupId,
      url: buildGmailSearch(subject).url,
      lastEmailLabel: cleanText(record.lastEmailLabel),
      lastEmailAt: cleanText(record.lastEmailAt),
      updatedAt: record.updatedAt || new Date().toISOString()
    };
  }

  async function clearCurrentAccountData() {
    const account = getAccountScope();
    const [notes, deadlines, cases, members] = await Promise.all([
      storeGetAll(NOTE_STORE), storeGetAll(DEADLINE_STORE), storeGetAll(CASE_STORE), storeGetAll(MEMBER_STORE)
    ]);
    for (const record of notes) if (record?.key?.startsWith(`${account}:`)) await storeDelete(NOTE_STORE, record.key);
    for (const record of deadlines) if (record?.key?.startsWith(`${account}:`)) await storeDelete(DEADLINE_STORE, record.key);
    for (const record of cases) if (record?.account === account) await storeDelete(CASE_STORE, record.id);
    for (const record of members) if (record?.account === account) await storeDelete(MEMBER_STORE, record.memberKey);
  }

  async function importJsonBackup(payload, mode = 'merge') {
    const backup = validateBackup(payload);
    const targetAccount = getAccountScope();
    const sourceAccount = cleanText(backup.sourceAccount);
    const notes = backup.data.notes.map((record) => normalizeImportedNote(record, sourceAccount, targetAccount)).filter(Boolean);
    const deadlines = backup.data.deadlines.map((record) => normalizeImportedDeadline(record, sourceAccount, targetAccount)).filter(Boolean);
    const cases = backup.data.cases.map((record) => normalizeImportedCase(record, targetAccount)).filter(Boolean);
    const members = backup.data.members.map((record) => normalizeImportedMember(record, sourceAccount, targetAccount)).filter(Boolean);

    if (mode === 'replace') await clearCurrentAccountData();

    const knownCaseIds = new Set(cases.map((record) => record.id));
    if (mode !== 'replace') {
      await loadCache(true);
      for (const id of cache.casesById.keys()) knownCaseIds.add(id);
    }

    for (const record of notes) await storePut(NOTE_STORE, record);
    for (const record of deadlines) await storePut(DEADLINE_STORE, record);
    for (const record of cases) await storePut(CASE_STORE, record);
    for (const record of members) {
      if (knownCaseIds.has(record.groupId)) await storePut(MEMBER_STORE, record);
    }

    invalidateCache();
    await loadCache(true);
    return {
      notes: notes.length,
      deadlines: deadlines.length,
      cases: cases.length,
      members: members.filter((record) => knownCaseIds.has(record.groupId)).length
    };
  }

  function backupCounts(payload) {
    const backup = validateBackup(payload);
    return {
      notes: backup.data.notes.length,
      deadlines: backup.data.deadlines.length,
      cases: backup.data.cases.length,
      members: backup.data.members.length
    };
  }

  function openAdmin() {
    window.open(adminUrl(), '_blank', 'noopener');
  }

  function ensureGlobalTools() {
    if (document.getElementById(GLOBAL_TOOLS_ID)) return;
    const tools = document.createElement('div');
    tools.id = GLOBAL_TOOLS_ID;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gsp-global-btn';
    button.title = 'Apri Gmail Superpowers Admin';
    button.appendChild(createSvgIcon('admin'));
    const label = document.createElement('span');
    label.textContent = 'Admin';
    button.appendChild(label);
    button.addEventListener('pointerdown', stopPropagationOnly, true);
    button.addEventListener('mousedown', stopPropagationOnly, true);
    button.addEventListener('click', (event) => {
      stopAction(event);
      openAdmin();
    }, true);
    tools.appendChild(button);
    document.body.appendChild(tools);
  }

  function adminStyles() {
    return `:host{all:initial}*{box-sizing:border-box}#app{position:fixed;inset:0;z-index:2147483647;background:#f6f8fc;color:#202124;font-family:Arial,sans-serif;font-size:14px;overflow:auto}header{height:68px;background:#fff;border-bottom:1px solid #e0e0e0;display:flex;align-items:center;padding:0 28px;gap:18px;position:sticky;top:0;z-index:3}.brand{font-size:20px;font-weight:700}.account{font-size:12px;color:#6b7280;flex:1}.close{border:1px solid #dadce0;background:#fff;border-radius:18px;height:34px;padding:0 13px;cursor:pointer}.layout{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:calc(100vh - 68px)}nav{padding:22px 14px;background:#fff;border-right:1px solid #e0e0e0}nav button{width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:10px 12px;margin:2px 0;cursor:pointer;font:14px Arial;color:#3c4043}nav button.active,nav button:hover{background:#e8f0fe;color:#174ea6}main{padding:26px 30px 60px;max-width:1180px;width:100%}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:26px 0 12px}.subtitle{color:#6b7280;margin-bottom:20px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}.pill,.action{border:1px solid #dadce0;background:#fff;border-radius:18px;height:34px;padding:0 12px;cursor:pointer}.pill.active{background:#e8f0fe;border-color:#aecbfa;color:#174ea6}.action.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}.action.danger{color:#b3261e;border-color:#f0b7b2}.card{background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin-bottom:12px}.row{display:grid;grid-template-columns:150px minmax(260px,1fr) minmax(180px,.8fr) minmax(150px,.6fr);gap:14px;align-items:center;padding:11px 12px;background:#fff;border-bottom:1px solid #eef0f2}.row.header{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;background:transparent}.row:last-child{border-bottom:0}.date-overdue{color:#b3261e;font-weight:700}.date-today{color:#7a5200;font-weight:700}.date-future{color:#137333}.email{color:#1a73e8;text-decoration:none;font-weight:600}.email:hover{text-decoration:underline}.muted{color:#80868b}.status{color:#4b5563}.case{color:#174ea6}.date-edit{width:145px;height:32px;border:1px solid #dadce0;border-radius:7px;padding:3px 7px;background:#fff}.case-card h3{margin:0 0 6px;font-size:17px}.case-status{width:min(620px,100%);height:34px;border:1px solid #dadce0;border-radius:7px;padding:5px 9px;margin:6px 0 10px}.members{margin:8px 0 0;padding-left:20px}.members li{margin:6px 0}.badge{display:inline-block;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:8px;background:#f1f3f4;color:#5f6368}.export-preview{background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:20px}.export-preview h3{margin:18px 0 6px}.export-preview h3:first-child{margin-top:0}.export-preview ul{padding-left:22px}.export-preview li{margin:6px 0}.empty{padding:24px;background:#fff;border:1px dashed #dadce0;border-radius:12px;color:#80868b;text-align:center}.import-grid{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,260px);gap:14px;align-items:end}.field label{display:block;font-size:12px;font-weight:700;color:#5f6368;margin-bottom:6px}.field select{width:100%;height:36px;border:1px solid #dadce0;border-radius:8px;background:#fff;padding:0 8px}.hint{font-size:12px;color:#6b7280;line-height:1.45;margin-top:8px}.summary{margin-top:10px;padding:10px 12px;border-radius:8px;background:#f8f9fa;color:#3c4043;font-size:12px}@media(max-width:850px){.layout{grid-template-columns:1fr}nav{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #e0e0e0;padding:8px;position:sticky;top:68px;z-index:2}nav button{width:auto;white-space:nowrap}.row{grid-template-columns:120px 1fr}.row>div:nth-child(n+3){grid-column:2}.import-grid{grid-template-columns:1fr}}`;
  }

  function aLink(subject) {
    const link = document.createElement('a');
    link.className = 'email';
    link.href = buildGmailSearch(subject).url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = subject || 'Conversazione senza oggetto';
    return link;
  }

  function adminEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function adminRelation(key, subject) {
    const note = findNoteForKey(key, subject);
    const member = findMemberForKey(key, subject);
    const group = member ? cache.casesById.get(member.groupId) : null;
    return {note, member, group};
  }

  function deadlineMatchesFilter(dueDate) {
    const today = localDateIso();
    if (deadlineFilter === 'overdue') return dueDate < today;
    if (deadlineFilter === 'today') return dueDate === today;
    if (deadlineFilter === '7') return dueDate >= today && dueDate <= addDaysIso(7);
    if (deadlineFilter === '30') return dueDate >= today && dueDate <= addDaysIso(30);
    return true;
  }

  async function renderAdminApp(force = false) {
    await loadCache(force);
    let host = document.getElementById(ADMIN_ROOT_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ADMIN_ROOT_ID;
      document.body.appendChild(host);
      host.attachShadow({mode: 'open'});
    }
    const root = host.shadowRoot;
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = adminStyles();
    root.appendChild(style);

    const app = adminEl('div');
    app.id = 'app';
    root.appendChild(app);
    const header = adminEl('header');
    const brand = adminEl('div', 'brand', 'Gmail Superpowers');
    const account = adminEl('div', 'account', `Admin - ${getAccountScope()} - dati locali del browser`);
    const close = adminEl('button', 'close', 'Chiudi');
    close.type = 'button';
    close.addEventListener('click', () => {
      if (window.opener) window.close();
      else location.hash = '#inbox';
    });
    header.append(brand, account, close);
    app.appendChild(header);

    const layout = adminEl('div', 'layout');
    const nav = adminEl('nav');
    const main = adminEl('main');
    layout.append(nav, main);
    app.appendChild(layout);

    for (const [id, label] of [['deadlines', 'Scadenze'], ['cases', 'Casi'], ['statuses', 'Stati'], ['export', 'Export / Import']]) {
      const button = adminEl('button', adminView === id ? 'active' : '', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        adminView = id;
        void renderAdminApp(false);
      });
      nav.appendChild(button);
    }

    if (adminView === 'deadlines') renderAdminDeadlines(main);
    else if (adminView === 'cases') renderAdminCases(main);
    else if (adminView === 'statuses') renderAdminStatuses(main);
    else renderAdminExportImport(main);
    document.title = 'Gmail Superpowers Admin';
  }

  function renderAdminDeadlines(main) {
    main.append(adminEl('h1', '', 'Scadenze'), adminEl('div', 'subtitle', 'Conversazioni ordinate per data di scadenza. Le modifiche vengono salvate direttamente in IndexedDB.'));
    const toolbar = adminEl('div', 'toolbar');
    for (const [id, label] of [['all', 'Tutte'], ['overdue', 'Scadute'], ['today', 'Oggi'], ['7', 'Prossimi 7 giorni'], ['30', 'Prossimi 30 giorni']]) {
      const button = adminEl('button', `pill${deadlineFilter === id ? ' active' : ''}`, label);
      button.type = 'button';
      button.addEventListener('click', () => {
        deadlineFilter = id;
        void renderAdminApp(false);
      });
      toolbar.appendChild(button);
    }
    main.appendChild(toolbar);

    const records = allDeadlinesSorted().filter((record) => deadlineMatchesFilter(record.dueDate));
    if (!records.length) {
      main.appendChild(adminEl('div', 'empty', 'Nessuna scadenza in questa vista.'));
      return;
    }

    const table = adminEl('div', 'card');
    const head = adminEl('div', 'row header');
    for (const text of ['Scadenza', 'Email', 'Stato', 'Caso']) head.appendChild(adminEl('div', '', text));
    table.appendChild(head);

    for (const due of records) {
      const row = adminEl('div', 'row');
      const dateBox = adminEl('div');
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = `date-edit date-${dueClass(due.dueDate)}`;
      dateInput.value = due.dueDate;
      dateInput.title = formatDate(due.dueDate);
      dateInput.addEventListener('change', async () => {
        await saveDeadline(due.key, due.subject, dateInput.value);
        invalidateCache();
        await renderAdminApp(true);
      });
      dateBox.appendChild(dateInput);

      const emailBox = adminEl('div');
      emailBox.appendChild(aLink(due.subject));
      const relation = adminRelation(due.key, due.subject);
      row.append(dateBox, emailBox, adminEl('div', 'status', cleanText(relation.note?.text) || '-'), adminEl('div', 'case', relation.group?.name || '-'));
      table.appendChild(row);
    }
    main.appendChild(table);
  }

  function renderAdminCases(main) {
    main.append(adminEl('h1', '', 'Casi'), adminEl('div', 'subtitle', 'Vista amministrativa dei gruppi di conversazioni e del loro stato condiviso.'));
    const groups = [...cache.casesById.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    if (!groups.length) {
      main.appendChild(adminEl('div', 'empty', 'Nessun caso creato.'));
      return;
    }

    for (const group of groups) {
      const card = adminEl('section', 'card case-card');
      card.appendChild(adminEl('h3', '', group.name));
      const status = document.createElement('input');
      status.type = 'text';
      status.className = 'case-status';
      status.value = cleanText(group.status);
      status.placeholder = 'Stato del caso';
      status.addEventListener('change', async () => {
        await saveCaseStatus(group, status.value);
        invalidateCache();
      });
      card.appendChild(status);

      const list = adminEl('ul', 'members');
      const members = [...(cache.membersByCase.get(group.id) || [])].sort((a, b) => cleanText(a.subject).localeCompare(cleanText(b.subject), 'it'));
      if (!members.length) list.appendChild(adminEl('li', 'muted', 'Nessuna conversazione collegata.'));
      for (const member of members) {
        const item = adminEl('li');
        item.appendChild(aLink(member.subject));
        const latest = formatLatestEmail(member);
        if (latest) item.appendChild(adminEl('span', 'badge', `Ultima email ${latest}`));
        const note = findNoteForMember(member);
        const due = findDeadlineForMember(member);
        if (due?.dueDate) item.appendChild(adminEl('span', `badge date-${dueClass(due.dueDate)}`, `Scade ${formatDate(due.dueDate)}`));
        if (note?.text) item.appendChild(adminEl('span', 'badge', cleanText(note.text)));
        list.appendChild(item);
      }
      card.appendChild(list);
      main.appendChild(card);
    }
  }

  function renderAdminStatuses(main) {
    main.append(adminEl('h1', '', 'Stati'), adminEl('div', 'subtitle', 'Tutte le conversazioni con uno stato salvato, con scadenza e caso quando disponibili.'));
    const notes = [...cache.notesByKey.values()].sort((a, b) => {
      const aDue = findDeadlineForKey(a.key, a.subject)?.dueDate || '9999-99-99';
      const bDue = findDeadlineForKey(b.key, b.subject)?.dueDate || '9999-99-99';
      return aDue.localeCompare(bDue) || cleanText(a.subject).localeCompare(cleanText(b.subject), 'it');
    });
    if (!notes.length) {
      main.appendChild(adminEl('div', 'empty', 'Nessuno stato salvato.'));
      return;
    }

    const table = adminEl('div', 'card');
    const head = adminEl('div', 'row header');
    for (const text of ['Scadenza', 'Email', 'Stato', 'Caso']) head.appendChild(adminEl('div', '', text));
    table.appendChild(head);

    for (const note of notes) {
      const due = findDeadlineForKey(note.key, note.subject);
      const member = findMemberForKey(note.key, note.subject);
      const group = member ? cache.casesById.get(member.groupId) : null;
      const row = adminEl('div', 'row');
      row.appendChild(adminEl('div', due?.dueDate ? `date-${dueClass(due.dueDate)}` : 'muted', due?.dueDate ? formatDate(due.dueDate) : '-'));
      const emailBox = adminEl('div');
      emailBox.appendChild(aLink(note.subject));
      row.append(emailBox, adminEl('div', 'status', cleanText(note.text)), adminEl('div', 'case', group?.name || '-'));
      table.appendChild(row);
    }
    main.appendChild(table);
  }

  function renderAdminExportImport(main) {
    main.append(adminEl('h1', '', 'Export / Import'), adminEl('div', 'subtitle', 'Markdown per consultazione e condivisione; JSON per backup e ripristino completo dei dati locali.'));

    const exportCard = adminEl('section', 'card');
    exportCard.appendChild(adminEl('h2', '', 'Export'));
    const toolbar = adminEl('div', 'toolbar');
    const downloadMd = adminEl('button', 'action primary', 'Scarica Markdown');
    downloadMd.type = 'button';
    downloadMd.addEventListener('click', () => downloadMarkdown(buildMarkdownExport()));
    const copyMd = adminEl('button', 'action', 'Copia Markdown');
    copyMd.type = 'button';
    copyMd.addEventListener('click', async () => {
      await copyText(buildMarkdownExport());
      showToast('Markdown copiato');
    });
    const backupJson = adminEl('button', 'action', 'Backup JSON');
    backupJson.type = 'button';
    backupJson.addEventListener('click', () => {
      downloadJsonBackup();
      showToast('Backup JSON creato');
    });
    toolbar.append(downloadMd, copyMd, backupJson);
    exportCard.appendChild(toolbar);
    exportCard.appendChild(adminEl('div', 'hint', 'Il JSON conserva chiavi, casi, collegamenti, stati, scadenze e data dell ultima email. E il formato consigliato per il ripristino.'));
    main.appendChild(exportCard);

    const importCard = adminEl('section', 'card');
    importCard.appendChild(adminEl('h2', '', 'Import JSON'));
    const grid = adminEl('div', 'import-grid');
    const modeField = adminEl('div', 'field');
    const modeLabel = adminEl('label', '', 'Modalita di importazione');
    const mode = document.createElement('select');
    const mergeOption = document.createElement('option');
    mergeOption.value = 'merge';
    mergeOption.textContent = 'Merge - aggiungi/aggiorna';
    const replaceOption = document.createElement('option');
    replaceOption.value = 'replace';
    replaceOption.textContent = 'Sostituisci i dati correnti';
    mode.append(mergeOption, replaceOption);
    modeField.append(modeLabel, mode);

    const fileField = adminEl('div', 'field');
    const fileLabel = adminEl('label', '', 'File di backup');
    const choose = adminEl('button', 'action primary', 'Scegli JSON e importa');
    choose.type = 'button';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileField.append(fileLabel, choose, fileInput);
    grid.append(modeField, fileField);
    importCard.appendChild(grid);
    importCard.appendChild(adminEl('div', 'hint', 'Merge sovrascrive solo record con la stessa chiave o lo stesso ID. Sostituisci elimina prima tutti i dati Gmail Superpowers dell account attualmente aperto, lasciando intatti gli altri slot Gmail del browser.'));
    const summary = adminEl('div', 'summary', 'Nessun file selezionato.');
    importCard.appendChild(summary);

    choose.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        const counts = backupCounts(payload);
        summary.textContent = `Backup: ${counts.cases} casi, ${counts.members} conversazioni collegate, ${counts.notes} stati, ${counts.deadlines} scadenze.`;
        if (mode.value === 'replace') {
          const ok = window.confirm(`Sostituire i dati Gmail Superpowers di ${getAccountScope()}? Questa operazione elimina i dati correnti di questo account prima dell import.`);
          if (!ok) {
            fileInput.value = '';
            return;
          }
        }
        const imported = await importJsonBackup(payload, mode.value);
        summary.textContent = `Import completato: ${imported.cases} casi, ${imported.members} collegamenti, ${imported.notes} stati, ${imported.deadlines} scadenze.`;
        showToast('Import JSON completato');
        await renderAdminApp(true);
      } catch (error) {
        console.error('[Gmail Superpowers] Import error:', error);
        summary.textContent = `Errore import: ${error.message || error}`;
        showToast('Import JSON non riuscito', true);
      } finally {
        fileInput.value = '';
      }
    });
    main.appendChild(importCard);

    const preview = adminEl('div', 'export-preview');
    const groups = [...cache.casesById.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    preview.appendChild(adminEl('h2', '', 'Anteprima'));
    preview.appendChild(adminEl('h3', '', 'Casi'));
    if (!groups.length) preview.appendChild(adminEl('div', 'muted', 'Nessun caso.'));
    for (const group of groups) {
      preview.appendChild(adminEl('h3', '', group.name));
      preview.appendChild(adminEl('div', 'status', `Stato: ${cleanText(group.status) || '-'}`));
      const list = adminEl('ul');
      for (const member of cache.membersByCase.get(group.id) || []) {
        const item = adminEl('li');
        item.appendChild(aLink(member.subject));
        const latest = formatLatestEmail(member);
        if (latest) item.appendChild(adminEl('span', 'badge', `Ultima email ${latest}`));
        const note = findNoteForMember(member);
        const due = findDeadlineForMember(member);
        if (note?.text) item.appendChild(adminEl('span', 'badge', cleanText(note.text)));
        if (due?.dueDate) item.appendChild(adminEl('span', `badge date-${dueClass(due.dueDate)}`, `Scade ${formatDate(due.dueDate)}`));
        list.appendChild(item);
      }
      preview.appendChild(list);
    }
    main.appendChild(preview);
  }

  async function refreshAll(force = false) {
    injectStyles();
    ensureGlobalTools();
    document.querySelectorAll('tr.zA').forEach(enhanceMailRow);
    await refreshRows(force);
    enhanceOpenActions();
    await enhanceOpenNote();
    await enhanceOpenDeadline();
    await enhanceCasePanel(force);
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshAll(false);
    }, 120);
  }

  if (isAdminRoute()) {
    void renderAdminApp(true);
    return;
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  scheduleRefresh();
})();