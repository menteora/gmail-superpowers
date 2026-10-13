/**
 * Visual workspace served by the same Apps Script project as the Gmail add-on.
 * Publish separately as a private Web App (Execute as: Me / Access: Only myself).
 * Data never leaves the owner-controlled Google Spreadsheet.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Gmail Superpowers — Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Public RPC: google.script.run cannot invoke functions ending in _. */
function gspDashboardData() {
  const id = PropertiesService.getScriptProperties().getProperty('GSP_STORAGE_SPREADSHEET_ID');
  if (!id) throw new Error('Archivio non configurato in questo progetto Apps Script. Apri l add-on Gmail e premi Inizializza storage; poi ricarica la dashboard.');
  const ctx = loadStorageSnapshot_(SpreadsheetApp.openById(id));
  const active = listRecords_(false, ctx.records);
  const cases = active.filter(row => row.type === 'case');
  const archive = gspReadArchive_(ctx.ss);
  const today = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
  const expiry = new Date(today + 'T12:00:00Z');
  expiry.setUTCDate(expiry.getUTCDate() + 7);
  const weekEnd = Utilities.formatDate(expiry, 'UTC', 'yyyy-MM-dd');

  const casesById = new Map();
  cases.forEach(row => casesById.set(row.key, {
    id: row.key,
    name: row.name || 'Caso senza nome',
    notes: row.notes || '',
    emails: []
  }));
  const emails = new Map();
  const getEmail = (row) => {
    const key = String(row.key || '');
    if (!emails.has(key)) emails.set(key, {
      key, subject: row.subject || '', threadId: row.threadId || '',
      caseId: '', status: '', notes: '', dueDate: '', lastEmailAt: '', url: '',
      lastEmailKnown: false
    });
    const item = emails.get(key);
    if (!item.subject && row.subject) item.subject = row.subject;
    if (!item.threadId && row.threadId) item.threadId = row.threadId;
    return item;
  };
  active.forEach(row => {
    if (row.type !== 'member' && row.type !== 'note' && row.type !== 'deadline') return;
    const item = getEmail(row);
    if (row.type === 'member') {
      item.caseId = row.groupId || '';
      item.lastEmailAt = row.lastEmailAt || '';
      item.lastEmailKnown = !!row.lastEmailAt;
      item.url = row.url || '';
    } else if (row.type === 'note') {
      item.status = row.text || '';
      item.notes = row.notes || '';
    } else if (row.type === 'deadline') {
      item.dueDate = row.dueDate || '';
    }
  });

  const ungrouped = [];
  for (const item of emails.values()) {
    // Never trust raw URLs stored in the Sheet: always build a Gmail search link.
    item.url = buildGmailSearchUrl_(item.subject || '');
    if (item.caseId && casesById.has(item.caseId)) casesById.get(item.caseId).emails.push(item);
    else {
      item.caseId = '';
      ungrouped.push(item);
    }
  }
  const orderEmail = (a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')
    || (b.lastEmailAt || '').localeCompare(a.lastEmailAt || '')
    || a.subject.localeCompare(b.subject, 'it');
  [...casesById.values()].forEach(group => group.emails.sort(orderEmail));
  ungrouped.sort(orderEmail);

  const items = [...emails.values()];
  const dates = items.map(item => item.dueDate).filter(Boolean);
  return {
    today,
    weekEnd,
    refreshedAt: new Date().toISOString(),
    spreadsheetUrl: ctx.ss.getUrl(),
    cases: [...casesById.values()],
    ungrouped,
    archive: archive.map(item => ({
      id: item.id, name: item.name, type: item.type, at: item.at,
      count: item.records.filter(row => row.type === 'member').length
    })).sort((a, b) => b.at.localeCompare(a.at)),
    metrics: {
      cases: cases.length,
      emails: items.length,
      overdue: dates.filter(d => d < today).length,
      today: dates.filter(d => d === today).length,
      week: dates.filter(d => d > today && d <= weekEnd).length,
      noDue: items.length - dates.length
    }
  };
}

/**
 * Public RPC actions. Strict, explicit dispatch keeps arbitrary method calls
 * and arbitrary Sheet mutations out of the browser.
 */
function gspDashboardMutate(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Richiesta non valida');
  const action = String(payload.action || '');
  const id = String(payload.id || '');
  if (!id || id.length > 500) throw new Error('Identificativo non valido');
  const allowed = ['detach', 'archive-case', 'archive-email', 'restore', 'save-email'];
  if (!allowed.includes(action)) throw new Error('Operazione non consentita');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (action === 'detach') return gspDetachByKey_(id);
    if (action === 'archive-case') return gspArchiveCase_(id);
    if (action === 'archive-email') return gspArchiveEmailByKey_(id);
    if (action === 'restore') {
      gspRestoreArchive_(id);
      return {ok: true};
    }
    const patch = payload.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Dati di modifica non validi');
    return gspSaveEmailByKey_(id, patch);
  } finally {
    lock.releaseLock();
  }
}
