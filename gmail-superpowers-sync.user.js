// ==UserScript==
// @name         Gmail Superpowers Sync Bridge
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.2.0
// @description  Bidirectional sync bridge between Gmail Superpowers IndexedDB and the Apps Script add-on Sheet storage.
// @author       menteora
// @match        https://mail.google.com/mail/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @homepageURL  https://github.com/menteora/gmail-superpowers
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers-sync.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DB_NAME = 'gmail-superpowers';
  const DB_VERSION = 3;
  const STORES = {note: 'thread-notes', deadline: 'deadlines', case: 'cases', member: 'case-members'};
  const CONFIG_URL = 'gsp-sync-webapp-url';
  const CONFIG_TOKEN = 'gsp-sync-token';
  const LAST_KEYS = 'gsp-sync-last-keys';
  const POLL_MS = 15000;

  let dbPromise = null;
  let syncRunning = false;
  let syncQueued = false;

  GM_registerMenuCommand('GSP Sync: configura Apps Script', configureSync);
  GM_registerMenuCommand('GSP Sync: sincronizza ora', () => syncNow(true));
  GM_registerMenuCommand('GSP Sync: cancella configurazione', clearConfig);

  function accountScope() {
    const match = location.pathname.match(/\/mail\/u\/(\d+)\//);
    return match ? `u${match[1]}` : 'u-default';
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.note)) db.createObjectStore(STORES.note, {keyPath: 'key'});
        if (!db.objectStoreNames.contains(STORES.deadline)) db.createObjectStore(STORES.deadline, {keyPath: 'key'});
        if (!db.objectStoreNames.contains(STORES.case)) db.createObjectStore(STORES.case, {keyPath: 'id'});
        if (!db.objectStoreNames.contains(STORES.member)) db.createObjectStore(STORES.member, {keyPath: 'memberKey'});
      };
    });
    return dbPromise;
  }

  async function all(storeName) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function get(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(storeName, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
      request.onsuccess = () => resolve(value);
      request.onerror = () => reject(request.error);
    });
  }

  async function remove(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function config() {
    return {
      url: String(GM_getValue(CONFIG_URL, '') || '').trim(),
      token: String(GM_getValue(CONFIG_TOKEN, '') || '').trim()
    };
  }

  function configureSync() {
    const current = config();
    const url = prompt('URL della Web App Apps Script (/exec)', current.url);
    if (url === null) return;
    const token = prompt('Token bridge mostrato nella home dell add-on', current.token);
    if (token === null) return;
    GM_setValue(CONFIG_URL, String(url).trim());
    GM_setValue(CONFIG_TOKEN, String(token).trim());
    void syncNow(true);
  }

  function clearConfig() {
    if (!confirm('Cancellare URL e token del bridge Apps Script?')) return;
    GM_setValue(CONFIG_URL, '');
    GM_setValue(CONFIG_TOKEN, '');
    GM_setValue(LAST_KEYS, '');
  }

  function postJson(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {'Content-Type': 'application/json'},
        data: JSON.stringify(payload),
        timeout: 20000,
        onload(response) {
          try {
            const result = JSON.parse(response.responseText || '{}');
            if (!result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error('Errore di rete verso Apps Script')),
        ontimeout: () => reject(new Error('Timeout Apps Script'))
      });
    });
  }

  function threadIdFromKey(key) {
    const match = String(key || '').match(/:thread:([^:]+)$/);
    return match ? match[1] : '';
  }

  function readLastKeys() {
    try {
      return JSON.parse(GM_getValue(LAST_KEYS, '') || '{}');
    } catch (_) {
      return {};
    }
  }

  async function localRecords() {
    const account = accountScope();
    const [notes, deadlines, cases, members] = await Promise.all([
      all(STORES.note), all(STORES.deadline), all(STORES.case), all(STORES.member)
    ]);
    const records = [];

    notes.filter((r) => String(r.key || '').startsWith(`${account}:`)).forEach((r) => records.push({
      type: 'note', key: r.key, account, threadId: threadIdFromKey(r.key), subject: r.subject || '', text: r.text || '', updatedAt: r.updatedAt || ''
    }));
    deadlines.filter((r) => String(r.key || '').startsWith(`${account}:`)).forEach((r) => records.push({
      type: 'deadline', key: r.key, account, threadId: threadIdFromKey(r.key), subject: r.subject || '', dueDate: r.dueDate || '', updatedAt: r.updatedAt || ''
    }));
    cases.filter((r) => r.account === account).forEach((r) => records.push({
      type: 'case', key: r.id, account, name: r.name || '', status: r.status || '', createdAt: r.createdAt || '', updatedAt: r.updatedAt || ''
    }));
    members.filter((r) => r.account === account).forEach((r) => records.push({
      type: 'member', key: r.memberKey, account, threadId: r.threadId || threadIdFromKey(r.memberKey), subject: r.subject || '', groupId: r.groupId || '', url: r.url || '', lastEmailLabel: r.lastEmailLabel || '', lastEmailAt: r.lastEmailAt || '', updatedAt: r.updatedAt || ''
    }));

    const currentKeys = {};
    records.forEach((record) => currentKeys[`${record.type}:${record.key}`] = true);
    const previousKeys = readLastKeys();
    const now = new Date().toISOString();
    Object.keys(previousKeys).forEach((composite) => {
      if (currentKeys[composite]) return;
      const separator = composite.indexOf(':');
      const type = composite.slice(0, separator);
      const key = composite.slice(separator + 1);
      if (STORES[type]) records.push({type, key, account, updatedAt: now, deletedAt: now});
    });

    return {records, currentKeys};
  }

  function localKey(remoteKey, type) {
    if (type === 'case') return remoteKey;
    const account = accountScope();
    const value = String(remoteKey || '');
    const thread = value.match(/^(?:[^:]+:)?thread:(.+)$/);
    if (thread) return `${account}:thread:${thread[1]}`;
    const subject = value.match(/^(?:[^:]+:)?subject:(.+)$/);
    if (subject) return `${account}:subject:${subject[1]}`;
    return value;
  }

  function recordTime(record) {
    const time = Date.parse(record?.deletedAt || record?.updatedAt || record?.createdAt || '');
    return Number.isFinite(time) ? time : 0;
  }

  async function applyRemote(record) {
    if (!record || !STORES[record.type] || !record.key) return;
    const account = accountScope();
    const key = localKey(record.key, record.type);
    const store = STORES[record.type];
    const existing = await get(store, key);
    if (existing && recordTime(existing) > recordTime(record)) return;
    if (record.deletedAt) return remove(store, key);

    if (record.type === 'note') {
      if (!String(record.text || '').trim()) return remove(store, key);
      return put(store, {key, subject: record.subject || '', text: record.text || '', updatedAt: record.updatedAt || new Date().toISOString()});
    }
    if (record.type === 'deadline') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate || '')) return remove(store, key);
      return put(store, {key, subject: record.subject || '', dueDate: record.dueDate, updatedAt: record.updatedAt || new Date().toISOString()});
    }
    if (record.type === 'case') {
      return put(store, {id: record.key, account, name: record.name || '', status: record.status || '', createdAt: record.createdAt || record.updatedAt || new Date().toISOString(), updatedAt: record.updatedAt || new Date().toISOString()});
    }
    if (record.type === 'member') {
      if (!String(record.groupId || '').trim()) return remove(store, key);
      return put(store, {
        memberKey: key,
        account,
        threadId: record.threadId || threadIdFromKey(key),
        subject: record.subject || '',
        groupId: record.groupId || '',
        url: record.url || '',
        lastEmailLabel: record.lastEmailLabel || '',
        lastEmailAt: record.lastEmailAt || '',
        updatedAt: record.updatedAt || new Date().toISOString()
      });
    }
  }

  async function syncNow(showErrors = false) {
    const current = config();
    if (!current.url || !current.token) return;
    if (syncRunning) {
      syncQueued = true;
      return;
    }
    syncRunning = true;
    try {
      const local = await localRecords();
      const response = await postJson(current.url, {
        action: 'sync',
        token: current.token,
        clientScope: accountScope(),
        records: local.records
      });
      for (const record of (Array.isArray(response.records) ? response.records : [])) await applyRemote(record);
      const refreshed = await localRecords();
      GM_setValue(LAST_KEYS, JSON.stringify(refreshed.currentKeys));
      if (showErrors) console.info('[Gmail Superpowers Sync] sincronizzazione completata');
    } catch (error) {
      console.warn('[Gmail Superpowers Sync]', error);
      if (showErrors) alert(`Sync non riuscita: ${error.message || error}`);
    } finally {
      syncRunning = false;
      if (syncQueued) {
        syncQueued = false;
        setTimeout(() => syncNow(false), 250);
      }
    }
  }

  window.addEventListener('focus', () => void syncNow(false));
  window.addEventListener('hashchange', () => void syncNow(false));
  setInterval(() => void syncNow(false), POLL_MS);
  setTimeout(() => void syncNow(true), 1500);
})();
