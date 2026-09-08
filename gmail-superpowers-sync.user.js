// ==UserScript==
// @name         Gmail Superpowers Sync Bridge
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.3.1
// @description  Read-only bridge: pulls Gmail Superpowers data from the Apps Script Sheet into local IndexedDB. Never uploads local data.
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
  const POLL_MS = 15000;

  let dbPromise = null;
  let syncRunning = false;
  let syncQueued = false;

  GM_registerMenuCommand('GSP Sync: configura Apps Script', configureSync);
  GM_registerMenuCommand('GSP Sync: aggiorna da Sheet ora', () => pullNow(true));
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
    void pullNow(true);
  }

  function clearConfig() {
    if (!confirm('Cancellare URL e token del bridge Apps Script?')) return;
    GM_setValue(CONFIG_URL, '');
    GM_setValue(CONFIG_TOKEN, '');
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

  function localKey(remoteKey, type) {
    if (type === 'case') return String(remoteKey || '');
    const account = accountScope();
    const value = String(remoteKey || '');
    const thread = value.match(/^(?:[^:]+:)?thread:(.+)$/);
    if (thread) return `${account}:thread:${thread[1]}`;
    const subject = value.match(/^(?:[^:]+:)?subject:(.+)$/);
    if (subject) return `${account}:subject:${subject[1]}`;
    return value;
  }

  function threadIdFromLocalKey(key) {
    const value = String(key || '');
    const marker = ':thread:';
    const index = value.indexOf(marker);
    return index >= 0 ? value.slice(index + marker.length) : '';
  }

  async function applyRemote(record) {
    if (!record || !STORES[record.type] || !record.key) return;

    const account = accountScope();
    const key = localKey(record.key, record.type);
    const store = STORES[record.type];

    // The Sheet is authoritative. Only data received from the server is applied locally.
    // No IndexedDB record is ever uploaded back to Apps Script by this bridge.
    if (record.deletedAt) {
      await remove(store, key);
      return;
    }

    if (record.type === 'note') {
      const text = String(record.text || '').trim();
      if (!text) {
        await remove(store, key);
        return;
      }
      await put(store, {
        key,
        subject: record.subject || '',
        text,
        updatedAt: record.updatedAt || new Date().toISOString()
      });
      return;
    }

    if (record.type === 'deadline') {
      const dueDate = String(record.dueDate || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        await remove(store, key);
        return;
      }
      await put(store, {
        key,
        subject: record.subject || '',
        dueDate,
        updatedAt: record.updatedAt || new Date().toISOString()
      });
      return;
    }

    if (record.type === 'case') {
      const name = String(record.name || '').trim();
      if (!name) return;
      await put(store, {
        id: record.key,
        account,
        name,
        status: record.status || '',
        createdAt: record.createdAt || record.updatedAt || new Date().toISOString(),
        updatedAt: record.updatedAt || new Date().toISOString()
      });
      return;
    }

    if (record.type === 'member') {
      const groupId = String(record.groupId || '').trim();
      if (!groupId) {
        await remove(store, key);
        return;
      }
      await put(store, {
        memberKey: key,
        account,
        threadId: record.threadId || threadIdFromLocalKey(key),
        subject: record.subject || '',
        groupId,
        url: record.url || '',
        lastEmailLabel: record.lastEmailLabel || '',
        lastEmailAt: record.lastEmailAt || '',
        updatedAt: record.updatedAt || new Date().toISOString()
      });
    }
  }

  function notifyLocalReaders(recordCount) {
    const detail = {recordCount, syncedAt: new Date().toISOString()};
    try {
      window.dispatchEvent(new CustomEvent('gsp-sync-updated', {detail}));
    } catch (_) {}
    try {
      document.dispatchEvent(new CustomEvent('gsp-sync-updated', {detail}));
    } catch (_) {}
  }

  async function pullNow(showErrors = false) {
    const current = config();
    if (!current.url || !current.token) return;
    if (syncRunning) {
      syncQueued = true;
      return;
    }

    syncRunning = true;
    try {
      // IMPORTANT: records is always empty. The existing Apps Script sync endpoint therefore
      // performs no merge/write and only returns the records already stored in the Sheet.
      const response = await postJson(current.url, {
        action: 'sync',
        token: current.token,
        clientScope: accountScope(),
        records: []
      });

      const records = Array.isArray(response.records) ? response.records : [];
      for (const record of records) await applyRemote(record);
      notifyLocalReaders(records.length);

      if (showErrors) {
        console.info(`[Gmail Superpowers Sync] letti ${records.length} record dallo Sheet; nessun dato locale inviato`);
      }
    } catch (error) {
      console.warn('[Gmail Superpowers Sync]', error);
      if (showErrors) alert(`Aggiornamento da Sheet non riuscito: ${error.message || error}`);
    } finally {
      syncRunning = false;
      if (syncQueued) {
        syncQueued = false;
        setTimeout(() => pullNow(false), 250);
      }
    }
  }

  window.addEventListener('focus', () => void pullNow(false));
  window.addEventListener('hashchange', () => void pullNow(false));
  setInterval(() => void pullNow(false), POLL_MS);
  setTimeout(() => void pullNow(true), 1500);
})();
