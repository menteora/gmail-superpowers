// ==UserScript==
// @name         Gmail Superpowers Sync Bridge
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.1.0
// @description  Sync bridge between Gmail Superpowers IndexedDB and the Apps Script add-on storage.
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
// ==/UserScript==

(function () {
  'use strict';

  const DB_NAME = 'gmail-superpowers';
  const DB_VERSION = 3;
  const STORES = {
    note: 'thread-notes',
    deadline: 'deadlines',
    case: 'cases',
    member: 'case-members'
  };
  const CONFIG_URL = 'gsp-sync-webapp-url';
  const CONFIG_TOKEN = 'gsp-sync-token';
  const LAST_KEYS = 'gsp-sync-last-keys';
  const POLL_MS = 15000;

  let dbPromise = null;
  let syncRunning = false;
  let syncQueued = false;
  let lastSnapshotSignature = '';

  GM_registerMenuCommand('GSP Sync: configura Apps Script', configureSync);
  GM_registerMenuCommand('GSP Sync: sincronizza ora', () => syncNow(true));
  GM_registerMenuCommand('GSP Sync: cancella configurazione', clearSyncConfig);

  function getAccountScope() {
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

  async function storeGetAll(storeName) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeGet(storeName, key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
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

  function currentConfig() {
    return {
      url: String(GM_getValue(CONFIG_URL, '') || '').trim(),
      token: String(GM_getValue(CONFIG_TOKEN, '') || '').trim()
    };
  }

  function configureSync() {
    const current = currentConfig();
    const url = prompt('URL della Web App Apps Script (/exec)', current.url);
    if (url === null) return;
    const token = prompt('Token bridge mostrato nella home dell add-on', current.token);
    if (token === null) return;
    GM_setValue(CONFIG_URL, String(url).trim());
    GM_setValue(CONFIG_TOKEN, String(token).trim());
    lastSnapshotSignature = '';
    alert('Configurazione salvata. Avvio una sincronizzazione.');
    void syncNow(true);
  }

  function clearSyncConfig() {
    if (!confirm('Cancellare URL e token del bridge Apps Script?')) return;
    GM_setValue(CONFIG_URL, '');
    GM_setValue(CONFIG_TOKEN, '');
    GM_setValue(LAST_KEYS, '');
    lastSnapshotSignature = '';
    alert('Configurazione sync cancellata.');
  }

  function requestJson(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {'Content-Type': 'application/json'},
        data: JSON.stringify(payload),
        timeout: 20000,
        onload(response) {
          try {
            const data = JSON.parse(response.responseText || '{}');
            if (!data.ok) throw new Error(data.error || `HTTP ${response.status}`);
            resolve(data);
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error('Errore di rete verso Apps Script')),
        ontimeout: () => reject(new Error('Timeout Apps Script'))
      });
    });
  }

  async function buildLocalRecords() {
    const account = getAccountScope();
    const [notes, deadlines, cases, members] = await Promise.all([
      storeGetAll(STORES.note),
      storeGetAll(STORES.deadline),
      storeGetAll(STORES.case),
      storeGetAll(STORES.member)
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
    for (const record of records) currentKeys[`${record.type}:${record.key}`] = true;
    const previousKeys = readLastKeys();
    const now = new Date().toISOString();
    if (previousKeys) {
      for (const compositeKey of Object.keys(previousKeys)) {
        if (currentKeys[compositeKey]) continue;
        const split = compositeKey.indexOf(':');
        const type = compositeKey.slice(0, split);
        const key = compositeKey.slice(split + 1);
        if (!STORES[type]) continue;
        records.push({type, key, account, updatedAt: now, deletedAt: now});
      }
    }

    return {records, currentKeys};
  }

  function readLastKeys() {
    const raw = GM_getValue(LAST_KEYS, '');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function threadIdFromKey(key) {
    const match = String(key || '').match(/:thread:([^:]+)$/);
    return match ? match[1] : '';
  }

  function rebaseKey(key, type) {
    if (type === 'case') return key;
    const account = getAccountScope();
    const value = String(key || '');
    const threadMatch = value.match(/^(?:[^:]+:)?thread:(.+)$/);
    if (threadMatch) return `${account}:thread:${threadMatch[1]}`;
    const subjectMatch = value.match(/^(?:[^:]+:)?subject:(.+)$/);
    if (subjectMatch) return `${account}:subject:${subjectMatch[1]}`;
    return value;
  }

  function recordTime(record) {
    const value = record?.deletedAt || record?.updatedAt || record?.createdAt || '';
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  async function applyRemoteRecord(record) {
    if (!record || !STORES[record.type] || !record.key) return;
    const account = getAccountScope();
    const localKey = rebaseKey(record.key, record.type);
    const storeName = STORES[record.type];
    const existing = await storeGet(storeName, localKey);
    if (existing && recordTime(existing) > recordTime(record)) return;

    if (record.deletedAt) {
      await storeDelete(storeName, localKey);
      return;
    }

    if (record.type === 'note') {
      if (!String(record.text || '').trim()) return storeDelete(storeName, localKey);
      return storePut(storeName, {key: localKey, subject: record.subject || '', text: record.text || '', updatedAt: record.updatedAt || new Date().toISOString()});
    }
    if (record.type === 'deadline') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate || '')) return storeDelete(storeName, localKey);
      return storePut(storeName, {key: localKey, subject: record.subject || '', dueDate: record.dueDate, updatedAt: record.updatedAt || new Date().toISOString()});
    }
    if (record.type === 'case') {
      return storePut(storeName, {id: record.key, account, name: record.name || '', status: record.status || '', createdAt: record.createdAt || record.updatedAt || new Date().toISOString(), updatedAt: record.updatedAt || new Date().toISOString()});
    }
    if (record.type === 'member') {
      if (!String(record.groupId || '').trim()) return storeDelete(storeName, localKey);
      return storePut(storeName, {
        memberKey: localKey,
        account,
        threadId: record.threadId || threadIdFromKey(localKey),
        subject: record.subject || '',
        groupId: record.groupId || '',
        url: record.url || '',
        lastEmailLabel: record.lastEmailLabel || '',
        lastEmailAt: record.lastEmailAt || '',
        updatedAt: record.updatedAt || new Date().toISOString()
      });
    }
  }

  async function syncNow(force = false) {
    const config = currentConfig();
    if (!config.url || !config.token) return;
    if (syncRunning) {
      syncQueued = true;
      return;
    }
    syncRunning = true;
    try {
      const local = await buildLocalRecords();
      const signature = JSON.stringify(local.records.map((record) => [record.type, record.key, record.updatedAt, record.deletedAt || '']));
      if (!force && signature === lastSnapshotSignature) return;

      const response = await requestJson(config.url, {
        action: 'sync',
        token: config.token,
        clientScope: getAccountScope(),
        records: local.records
      });

      const remote = Array.isArray(response.records) ? response.records : [];
      for (const record of remote) await applyRemoteRecord(record);

      const refreshed = await buildLocalRecords();
      GM_setValue(LAST_KEYS, JSON.stringify(refreshed.currentKeys));
      lastSnapshotSignature = JSON.stringify(refreshed.records.map((record) => [record.type, record.key, record.updatedAt, record.deletedAt || '']));
      if (force) console.info('[Gmail Superpowers Sync] sincronizzazione completata');
    } catch (error) {
      console.warn('[Gmail Superpowers Sync]', error);
      if (force) alert(`Sync non riuscita: ${error.message || error}`);
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
