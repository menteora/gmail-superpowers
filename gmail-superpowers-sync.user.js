// ==UserScript==
// @name         Gmail Superpowers Sync Bridge (disabled)
// @namespace    https://github.com/menteora/gmail-superpowers
// @version      0.4.0
// @description  Legacy sync bridge retained only for compatibility. Automatic Apps Script /exec synchronization is disabled.
// @author       menteora
// @match        https://mail.google.com/mail/*
// @run-at       document-idle
// @homepageURL  https://github.com/menteora/gmail-superpowers
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers-sync.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Legacy file intentionally kept as an inert userscript so existing Tampermonkey
  // installations update cleanly without continuing to call the Apps Script /exec
  // endpoint. Gmail Superpowers now uses the native Gmail add-on + Google Sheet
  // storage directly, so polling and bridge configuration are no longer required.
  console.info('[Gmail Superpowers Sync] legacy /exec synchronization is disabled.');
})();
