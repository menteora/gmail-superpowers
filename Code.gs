const GSP_VERSION = '0.4.2';
const GSP_RECORD_SHEET = 'records';
const GSP_DASHBOARD_SHEET = 'dashboard';
const GSP_CASE_LABEL_ROOT = 'gs';
const GSP_STATUS_LABEL_ROOT = 'gss';
const GSP_COLUMNS = [
  'type', 'key', 'account', 'threadId', 'subject', 'text', 'dueDate',
  'groupId', 'name', 'status', 'url', 'lastEmailLabel', 'lastEmailAt',
  'createdAt', 'updatedAt', 'deletedAt', 'notes'
];
const GSP_DASHBOARD_COLUMNS = [
  'Caso', 'Stato caso', 'Email collegata', 'Stato email', 'Note',
  'Scadenza', 'Ultima email', 'Link'
];

function onHomepage(e) {
  return [buildHomeCard_()];
}

function onGmailMessageOpen(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const message = GmailApp.getMessageById(e.gmail.messageId);
  const thread = message.getThread();
  const messages = thread.getMessages();
  const lastMessage = messages[messages.length - 1];
  const context = {
    threadId: e.gmail.threadId || thread.getId(),
    subject: thread.getFirstMessageSubject() || message.getSubject() || '',
    lastEmailAt: lastMessage ? lastMessage.getDate().toISOString() : '',
    lastEmailLabel: lastMessage ? Utilities.formatDate(lastMessage.getDate(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : ''
  };
  return [buildConversationCard_(context)];
}

function setupStorageAction(e) {
  setupGmailSuperpowers();
  return updateCardResponse_(buildHomeCard_());
}

function rotateSyncTokenAction(e) {
  rotateSyncToken();
  return updateCardResponse_(buildHomeCard_());
}

function syncGmailLabelsAction(e) {
  const storage = loadStorageSnapshot_();
  const result = syncAllGmailLabels_(storage.records);
  return updateCardResponseWithNotification_(
    buildHomeCard_(),
    `Label Gmail sincronizzate: ${result.threads} conversazioni, ${result.cases} case, ${result.statuses} stati.`,
    true
  );
}

function refreshDashboardAction(e) {
  const storage = loadStorageSnapshot_();
  const result = refreshDashboard_(storage.ss, storage.records, storage.dashboardSheet);
  return updateCardResponseWithNotification_(
    buildHomeCard_(),
    `Dashboard aggiornata: ${result.rows} righe.`,
    true
  );
}

function saveConversation(e) {
  const storage = loadStorageSnapshot_();
  const params = (e.commonEventObject && e.commonEventObject.parameters) || {};
  const threadId = params.threadId || '';
  const subject = params.subject || '';
  const lastEmailAt = params.lastEmailAt || '';
  const lastEmailLabel = params.lastEmailLabel || '';
  const originalCaseId = params.originalCaseId || '';
  const state = getConversationState_(threadId, subject, storage.records);
  const now = new Date().toISOString();
  const key = state.member?.key || state.note?.key || state.deadline?.key || `addon:thread:${threadId}`;
  const account = state.member?.account || state.note?.account || state.deadline?.account || 'addon';

  const conversationStatus = resolveStatusInput_(e, 'status', 'newStatus');
  const notes = getStringInput_(e, 'notes').trim();
  const dueDate = getDateInputIso_(e, 'dueDate');
  const selectedCaseId = getStringInput_(e, 'caseId');
  const newCaseName = getStringInput_(e, 'newCaseName').trim();
  const caseStatus = resolveStatusInput_(e, 'caseStatus', 'newCaseStatus');

  let groupId = selectedCaseId || '';
  let caseStatusChanged = false;
  const pending = [];

  if (newCaseName) {
    groupId = Utilities.getUuid();
    pending.push({
      type: 'case', key: groupId, account, name: newCaseName, status: caseStatus,
      createdAt: now, updatedAt: now
    });
    caseStatusChanged = true;
  } else if (groupId && groupId === originalCaseId) {
    const currentCase = getRecordByKey_('case', groupId, storage.records);
    if (currentCase && (currentCase.status || '') !== caseStatus) {
      pending.push(Object.assign({}, currentCase, {status: caseStatus, updatedAt: now, deletedAt: ''}));
      caseStatusChanged = true;
    }
  }

  pending.push({
    type: 'note', key, account, threadId, subject,
    text: conversationStatus, notes,
    updatedAt: now, deletedAt: ''
  });
  pending.push({
    type: 'deadline', key, account, threadId, subject, dueDate,
    updatedAt: now, deletedAt: ''
  });
  pending.push({
    type: 'member', key, account, threadId, subject, groupId,
    url: buildGmailSearchUrl_(subject), lastEmailLabel, lastEmailAt,
    updatedAt: now, deletedAt: ''
  });

  upsertRecords_(pending, storage);

  const caseRecord = groupId ? getRecordByKey_('case', groupId, storage.records) : null;
  const caseLabelSync = syncThreadCaseLabel_(threadId, caseRecord);
  let statusLabelSync = syncThreadStatusLabels_(threadId, conversationStatus, caseRecord?.status || '');
  if (caseRecord && caseStatusChanged) {
    const caseStatusSync = syncCaseStatusLabels_(caseRecord.key, storage.records);
    if (!caseStatusSync.ok && statusLabelSync.ok) statusLabelSync = caseStatusSync;
  }

  refreshDashboard_(storage.ss, storage.records, storage.dashboardSheet);
  const card = buildConversationCard_({threadId, subject, lastEmailAt, lastEmailLabel}, storage.records);
  const labelError = !caseLabelSync.ok ? caseLabelSync.error : (!statusLabelSync.ok ? statusLabelSync.error : '');
  if (labelError) {
    return updateCardResponseWithNotification_(
      card,
      `Salvato, ma label Gmail non aggiornata: ${labelError}`,
      true
    );
  }

  const appliedLabels = [];
  if (caseLabelSync.label) appliedLabels.push(caseLabelSync.label);
  statusLabelSync.labels.forEach((label) => appliedLabels.push(label));
  return updateCardResponseWithNotification_(
    card,
    appliedLabels.length ? `Salvato · ${appliedLabels.join(' · ')}` : 'Salvato · nessuna label',
    true
  );
}

function removeCaseAction(e) {
  const storage = loadStorageSnapshot_();
  const params = (e.commonEventObject && e.commonEventObject.parameters) || {};
  const caseId = params.caseId || '';
  const context = {
    threadId: params.threadId || '',
    subject: params.subject || '',
    lastEmailAt: params.lastEmailAt || '',
    lastEmailLabel: params.lastEmailLabel || ''
  };
  const caseRecord = caseId ? getRecordByKey_('case', caseId, storage.records) : null;
  if (!caseRecord) return updateCardResponse_(buildConversationCard_(context, storage.records));

  const now = new Date().toISOString();
  const members = getActiveRecords_('member', storage.records).filter((member) => member.groupId === caseId);
  const updates = members.map((member) => Object.assign({}, member, {
    groupId: '', updatedAt: now, deletedAt: ''
  }));
  updates.push(Object.assign({}, caseRecord, {updatedAt: now, deletedAt: now}));
  upsertRecords_(updates, storage);

  members.forEach((member) => {
    syncThreadCaseLabel_(member.threadId, null);
    const note = getRecordByConversation_('note', member.threadId, member.subject, storage.records);
    syncThreadStatusLabels_(member.threadId, note?.text || '', '');
  });

  deleteCaseLabel_(caseRecord);
  refreshDashboard_(storage.ss, storage.records, storage.dashboardSheet);

  return updateCardResponseWithNotification_(
    buildConversationCard_(context, storage.records),
    `Caso rimosso: ${caseRecord.name || caseRecord.key}`,
    true
  );
}

function showPortableLinkAction(e) {
  const params = (e.commonEventObject && e.commonEventObject.parameters) || {};
  const subject = params.subject || '';
  const kind = params.kind === 'markdown' ? 'markdown' : 'url';
  const url = buildGmailSearchUrl_(subject);
  const value = kind === 'markdown'
    ? `[email: ${escapeMarkdownLabel_(subject)}](${url})`
    : url;

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(kind === 'markdown' ? 'Markdown' : 'URL'));
  const section = CardService.newCardSection();
  section.addWidget(CardService.newTextInput()
    .setFieldName('portableLinkValue')
    .setTitle(kind === 'markdown' ? 'Markdown da copiare' : 'URL da copiare')
    .setValue(value));
  section.addWidget(CardService.newTextParagraph().setText('Seleziona il testo e copialo con Ctrl+C.'));
  if (kind === 'url') {
    section.addWidget(CardService.newTextButton()
      .setText('Apri email')
      .setOpenLink(CardService.newOpenLink().setUrl(url)));
  }
  card.addSection(section);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function buildHomeCard_() {
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Gmail Superpowers'));
  const section = CardService.newCardSection();
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('GSP_STORAGE_SPREADSHEET_ID');

  if (!spreadsheetId) {
    section.addWidget(CardService.newTextParagraph().setText('Storage non inizializzato. I dati dell add-on verranno salvati in un Google Sheet dedicato.'));
    section.addWidget(CardService.newTextButton()
      .setText('Inizializza storage')
      .setOnClickAction(CardService.newAction().setFunctionName('setupStorageAction')));
  } else {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const dashboard = getDashboardSheet_(ss);
    section.addWidget(CardService.newKeyValue().setTopLabel('Storage').setContent(ss.getName()));
    section.addWidget(CardService.newTextButton().setText('Apri Google Sheet').setOpenLink(CardService.newOpenLink().setUrl(ss.getUrl())));
    section.addWidget(CardService.newTextButton()
      .setText('Apri dashboard')
      .setOpenLink(CardService.newOpenLink().setUrl(`${ss.getUrl()}#gid=${dashboard.getSheetId()}`)));
    section.addWidget(CardService.newTextButton()
      .setText('Aggiorna dashboard')
      .setOnClickAction(CardService.newAction().setFunctionName('refreshDashboardAction')));
    section.addWidget(CardService.newTextButton()
      .setText('Sincronizza label Gmail')
      .setOnClickAction(CardService.newAction().setFunctionName('syncGmailLabelsAction')));
  }
  card.addSection(section);
  return card.build();
}

function buildConversationCard_(context, records) {
  const snapshot = records || loadStorageSnapshot_().records;
  const state = getConversationState_(context.threadId, context.subject, snapshot);
  const statuses = getStatusCatalog_(snapshot);
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Gmail Superpowers').setSubtitle(context.subject || 'Conversazione'));

  const info = CardService.newCardSection();
  if (context.lastEmailLabel || context.lastEmailAt) {
    info.addWidget(CardService.newKeyValue().setTopLabel('Ultima email').setContent(context.lastEmailLabel || formatDateTime_(context.lastEmailAt)));
  }
  const portableButtons = CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText('URL')
      .setOnClickAction(CardService.newAction().setFunctionName('showPortableLinkAction').setParameters({
        subject: context.subject || '', kind: 'url'
      })))
    .addButton(CardService.newTextButton()
      .setText('Markdown')
      .setOnClickAction(CardService.newAction().setFunctionName('showPortableLinkAction').setParameters({
        subject: context.subject || '', kind: 'markdown'
      })));
  info.addWidget(portableButtons);
  card.addSection(info);

  const form = CardService.newCardSection().setHeader('Conversazione');
  form.addWidget(buildStatusSelection_('status', 'Stato', state.note?.text || '', statuses));
  form.addWidget(CardService.newTextInput()
    .setFieldName('newStatus')
    .setTitle('Nuovo stato')
    .setHint(`Se compilato, crea e usa la label ${GSP_STATUS_LABEL_ROOT}/nome stato`));
  form.addWidget(CardService.newTextInput()
    .setFieldName('notes')
    .setTitle('Note')
    .setMultiline(true)
    .setValue(state.note?.notes || ''));

  const picker = CardService.newDatePicker().setFieldName('dueDate').setTitle('Scadenza');
  if (state.deadline?.dueDate) picker.setValueInMsSinceEpoch(dateIsoToMs_(state.deadline.dueDate));
  form.addWidget(picker);

  const cases = getActiveRecords_('case', snapshot).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const selection = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('caseId');
  selection.addItem('Nessun caso', '', !state.member?.groupId);
  cases.forEach((item) => selection.addItem(item.name || item.key, item.key, item.key === state.member?.groupId));
  form.addWidget(selection);
  form.addWidget(CardService.newTextInput().setFieldName('newCaseName').setTitle('Nuovo caso').setHint('Se compilato, crea un nuovo caso e collega questa conversazione'));
  form.addWidget(buildStatusSelection_('caseStatus', 'Stato del caso', state.caseRecord?.status || '', statuses));
  form.addWidget(CardService.newTextInput()
    .setFieldName('newCaseStatus')
    .setTitle('Nuovo stato del caso')
    .setHint(`Se compilato, crea e usa la label ${GSP_STATUS_LABEL_ROOT}/nome stato sulle conversazioni del case`));

  const save = CardService.newTextButton()
    .setText('Salva')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('saveConversation').setParameters({
      threadId: context.threadId || '',
      subject: context.subject || '',
      lastEmailAt: context.lastEmailAt || '',
      lastEmailLabel: context.lastEmailLabel || '',
      originalCaseId: state.caseRecord?.key || ''
    }));
  form.addWidget(save);
  card.addSection(form);

  if (state.caseRecord) {
    const related = CardService.newCardSection().setHeader('Caso: ' + (state.caseRecord.name || ''));
    const members = getActiveRecords_('member', snapshot).filter((member) => member.groupId === state.caseRecord.key);
    if (!members.length) {
      related.addWidget(CardService.newTextParagraph().setText('Nessuna conversazione collegata.'));
    } else {
      members.forEach((member) => {
        const note = getRecordByConversation_('note', member.threadId, member.subject, snapshot);
        const deadline = getRecordByConversation_('deadline', member.threadId, member.subject, snapshot);
        const details = [];
        if (member.lastEmailAt || member.lastEmailLabel) details.push('ultima email ' + (member.lastEmailLabel || formatDateTime_(member.lastEmailAt)));
        if (deadline?.dueDate) details.push('scade ' + deadline.dueDate);
        if (note?.text) details.push('stato: ' + note.text);
        if (note?.notes) details.push('note: ' + compactText_(note.notes, 120));
        related.addWidget(CardService.newDecoratedText()
          .setText(member.subject || 'Conversazione')
          .setBottomLabel(details.join(' · ') || '')
          .setWrapText(true)
          .setOpenLink(CardService.newOpenLink().setUrl(member.url || buildGmailSearchUrl_(member.subject || ''))));
      });
    }
    related.addWidget(CardService.newTextButton()
      .setText('Rimuovi caso')
      .setOnClickAction(CardService.newAction().setFunctionName('removeCaseAction').setParameters({
        caseId: state.caseRecord.key || '',
        threadId: context.threadId || '',
        subject: context.subject || '',
        lastEmailAt: context.lastEmailAt || '',
        lastEmailLabel: context.lastEmailLabel || ''
      })));
    card.addSection(related);
  }

  return card.build();
}

function buildStatusSelection_(fieldName, title, currentValue, statuses) {
  const current = cleanStatus_(currentValue);
  const values = [...statuses];
  if (current && !values.some((value) => value.toLowerCase() === current.toLowerCase())) values.push(current);
  values.sort((a, b) => a.localeCompare(b, 'it', {sensitivity: 'base'}));

  const selection = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName(fieldName);
  selection.addItem('Nessuno stato', '', !current);
  values.forEach((value) => selection.addItem(value, value, value === current));
  return selection;
}

function resolveStatusInput_(e, selectedField, newField) {
  const created = cleanStatus_(getStringInput_(e, newField));
  if (created) return created;
  return cleanStatus_(getStringInput_(e, selectedField));
}

function getStatusCatalog_(records) {
  const statuses = new Map();
  const add = (value) => {
    const clean = cleanStatus_(value);
    if (!clean) return;
    const key = clean.toLocaleLowerCase('it');
    if (!statuses.has(key)) statuses.set(key, clean);
  };

  const source = listRecords_(false, records);
  source.filter((record) => record.type === 'note').forEach((record) => add(record.text));
  source.filter((record) => record.type === 'case').forEach((record) => add(record.status));
  GmailApp.getUserLabels().forEach((label) => {
    const name = label.getName();
    if (isManagedStatusLabelName_(name)) add(name.slice(GSP_STATUS_LABEL_ROOT.length + 1));
  });
  return [...statuses.values()].sort((a, b) => a.localeCompare(b, 'it', {sensitivity: 'base'}));
}

function doGet(e) {
  const token = e && e.parameter ? e.parameter.token : '';
  if (!isValidSyncToken_(token)) return json_({ok: false, error: 'unauthorized'});
  return json_({ok: true, version: GSP_VERSION, storage: !!PropertiesService.getScriptProperties().getProperty('GSP_STORAGE_SPREADSHEET_ID')});
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (!isValidSyncToken_(body.token)) return json_({ok: false, error: 'unauthorized'});
    if (body.action === 'ping') return json_({ok: true, version: GSP_VERSION});
    if (body.action !== 'sync') return json_({ok: false, error: 'unsupported_action'});

    const storage = loadStorageSnapshot_();
    const incoming = Array.isArray(body.records) ? body.records : [];
    upsertRecords_(incoming, storage);
    refreshDashboard_(storage.ss, storage.records, storage.dashboardSheet);
    return json_({ok: true, version: GSP_VERSION, records: listRecords_(true, storage.records)});
  } catch (error) {
    console.error(error);
    return json_({ok: false, error: String(error && error.message ? error.message : error)});
  }
}

function setupGmailSuperpowers() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('GSP_STORAGE_SPREADSHEET_ID');
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('Gmail Superpowers DB');
    spreadsheetId = spreadsheet.getId();
    props.setProperty('GSP_STORAGE_SPREADSHEET_ID', spreadsheetId);
  }
  const recordSheet = ensureRecordSheet_(spreadsheet);
  const dashboardSheet = ensureDashboardSheet_(spreadsheet);
  if (!props.getProperty('GSP_SYNC_TOKEN')) rotateSyncToken();
  const records = readRecordsFromSheet_(recordSheet);
  refreshDashboard_(spreadsheet, records, dashboardSheet);
  const result = {
    spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    dashboardUrl: `${spreadsheet.getUrl()}#gid=${dashboardSheet.getSheetId()}`,
    syncToken: props.getProperty('GSP_SYNC_TOKEN'),
    webAppUrl: ScriptApp.getService().getUrl() || ''
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function rotateSyncToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('GSP_SYNC_TOKEN', token);
  console.log('GSP sync token: ' + token);
  return token;
}

function ensureStorage_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GSP_STORAGE_SPREADSHEET_ID')) setupGmailSuperpowers();
  return SpreadsheetApp.openById(props.getProperty('GSP_STORAGE_SPREADSHEET_ID'));
}

function ensureRecordSheet_(ss) {
  let sheet = ss.getSheetByName(GSP_RECORD_SHEET);
  if (!sheet) sheet = ss.insertSheet(GSP_RECORD_SHEET);
  const firstRow = sheet.getRange(1, 1, 1, GSP_COLUMNS.length).getValues()[0];
  if (firstRow.join('|') !== GSP_COLUMNS.join('|')) {
    sheet.getRange(1, 1, 1, GSP_COLUMNS.length).setValues([GSP_COLUMNS]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function getRecordSheet_(ss) {
  return ss.getSheetByName(GSP_RECORD_SHEET) || ensureRecordSheet_(ss);
}

function ensureDashboardSheet_(ss) {
  let sheet = ss.getSheetByName(GSP_DASHBOARD_SHEET);
  if (!sheet) sheet = ss.insertSheet(GSP_DASHBOARD_SHEET);
  const width = GSP_DASHBOARD_COLUMNS.length;
  const current = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  if (current.join('|') !== GSP_DASHBOARD_COLUMNS.join('|')) {
    sheet.getRange(1, 1, 1, width).setValues([GSP_DASHBOARD_COLUMNS]);
  }
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 190);
  sheet.setColumnWidth(3, 320);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 360);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 165);
  sheet.setColumnWidth(8, 320);
  return sheet;
}

function getDashboardSheet_(ss) {
  return ss.getSheetByName(GSP_DASHBOARD_SHEET) || ensureDashboardSheet_(ss);
}

function loadStorageSnapshot_(spreadsheet) {
  const ss = spreadsheet || ensureStorage_();
  const recordSheet = getRecordSheet_(ss);
  const dashboardSheet = getDashboardSheet_(ss);
  return {
    ss,
    recordSheet,
    dashboardSheet,
    records: readRecordsFromSheet_(recordSheet)
  };
}

function readRecordsFromSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, GSP_COLUMNS.length).getDisplayValues();
  return values.map(rowToRecord_).filter((record) => record.type && record.key);
}

function writeRecordsToSheet_(sheet, records) {
  const rows = records.map(recordToRow_);
  const previousLastRow = sheet.getLastRow();
  const requiredRows = rows.length + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, GSP_COLUMNS.length).setValues(rows);
  }
  const previousDataRows = Math.max(0, previousLastRow - 1);
  if (previousDataRows > rows.length) {
    sheet.getRange(rows.length + 2, 1, previousDataRows - rows.length, GSP_COLUMNS.length).clearContent();
  }
}

function refreshDashboard_(spreadsheet, records, dashboardSheet) {
  const ss = spreadsheet || ensureStorage_();
  const dashboard = dashboardSheet || getDashboardSheet_(ss);
  const source = listRecords_(false, records || readRecordsFromSheet_(getRecordSheet_(ss)));
  const cases = source.filter((record) => record.type === 'case');
  const members = source.filter((record) => record.type === 'member');
  const casesById = new Map(cases.map((record) => [record.key, record]));
  const notes = source.filter((record) => record.type === 'note');
  const deadlines = source.filter((record) => record.type === 'deadline');

  const rows = [];
  const membersByCase = new Map();
  members.forEach((member) => {
    const key = member.groupId || '';
    membersByCase.set(key, [...(membersByCase.get(key) || []), member]);
  });

  cases
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'))
    .forEach((caseRecord) => {
      const linked = (membersByCase.get(caseRecord.key) || [])
        .sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'it'));
      if (!linked.length) {
        rows.push([caseRecord.name || caseRecord.key, caseRecord.status || '', '', '', '', '', '', '']);
        return;
      }
      linked.forEach((member) => rows.push(dashboardRow_(caseRecord, member, notes, deadlines)));
    });

  (membersByCase.get('') || [])
    .sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'it'))
    .forEach((member) => rows.push(dashboardRow_(null, member, notes, deadlines)));

  const dangling = members
    .filter((member) => member.groupId && !casesById.has(member.groupId))
    .sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'it'));
  dangling.forEach((member) => rows.push(dashboardRow_(null, member, notes, deadlines)));

  const previousLastRow = dashboard.getLastRow();
  const requiredRows = rows.length + 1;
  if (dashboard.getMaxRows() < requiredRows) {
    dashboard.insertRowsAfter(dashboard.getMaxRows(), requiredRows - dashboard.getMaxRows());
  }
  if (rows.length) {
    dashboard.getRange(2, 1, rows.length, GSP_DASHBOARD_COLUMNS.length)
      .setValues(rows)
      .setVerticalAlignment('top')
      .setWrap(true);
  }
  const previousDataRows = Math.max(0, previousLastRow - 1);
  if (previousDataRows > rows.length) {
    dashboard.getRange(rows.length + 2, 1, previousDataRows - rows.length, GSP_DASHBOARD_COLUMNS.length).clearContent();
  }

  const filter = dashboard.getFilter();
  if (filter) filter.remove();
  if (rows.length) dashboard.getRange(1, 1, rows.length + 1, GSP_DASHBOARD_COLUMNS.length).createFilter();
  return {rows: rows.length, sheetId: dashboard.getSheetId()};
}

function dashboardRow_(caseRecord, member, notes, deadlines) {
  const note = findConversationRecord_(notes, member);
  const deadline = findConversationRecord_(deadlines, member);
  const lastEmail = member.lastEmailLabel || (member.lastEmailAt ? formatDateTime_(member.lastEmailAt) : '');
  return [
    caseRecord ? (caseRecord.name || caseRecord.key) : '',
    caseRecord ? (caseRecord.status || '') : '',
    member.subject || '',
    note?.text || '',
    note?.notes || '',
    deadline?.dueDate || '',
    lastEmail,
    member.url || buildGmailSearchUrl_(member.subject || '')
  ];
}

function findConversationRecord_(records, member) {
  if (!member) return null;
  const normalized = normalizeSubject_(member.subject);
  return records.find((record) => {
    if (member.key && record.key === member.key) return true;
    if (member.threadId && record.threadId === member.threadId) return true;
    return normalized && normalizeSubject_(record.subject) === normalized;
  }) || null;
}

function listRecords_(includeDeleted, records) {
  const source = records || loadStorageSnapshot_().records;
  return source.filter((record) => record.type && record.key && (includeDeleted || !record.deletedAt));
}

function getActiveRecords_(type, records) {
  return listRecords_(false, records).filter((record) => record.type === type);
}

function getRecordByKey_(type, key, records) {
  return listRecords_(false, records).find((record) => record.type === type && record.key === key) || null;
}

function getRecordByConversation_(type, threadId, subject, records) {
  const normalized = normalizeSubject_(subject);
  return listRecords_(false, records).find((record) => {
    if (record.type !== type) return false;
    if (threadId && (record.threadId === threadId || record.key === 'thread:' + threadId || record.key.endsWith(':thread:' + threadId))) return true;
    return normalized && normalizeSubject_(record.subject) === normalized;
  }) || null;
}

function getConversationState_(threadId, subject, records) {
  const note = getRecordByConversation_('note', threadId, subject, records);
  const deadline = getRecordByConversation_('deadline', threadId, subject, records);
  const member = getRecordByConversation_('member', threadId, subject, records);
  const caseRecord = member && member.groupId ? getRecordByKey_('case', member.groupId, records) : null;
  return {note, deadline, member, caseRecord};
}

function mergeRecords_(records) {
  return upsertRecords_(records);
}

function upsertRecord_(raw) {
  const results = upsertRecords_([raw]);
  return results[0] || null;
}

function upsertRecords_(rawRecords, storage) {
  const ctx = storage || loadStorageSnapshot_();
  const records = ctx.records;
  const index = new Map();
  records.forEach((record, position) => index.set(recordIdentity_(record), position));

  const results = [];
  let changed = false;

  rawRecords.forEach((raw) => {
    const record = normalizeRecord_(raw);
    if (!record.type || !record.key) return;
    const identity = recordIdentity_(record);
    const position = index.has(identity) ? index.get(identity) : -1;
    const existing = position >= 0 ? records[position] : null;

    if (existing && compareRecordTime_(record, existing) < 0) {
      results.push(existing);
      return;
    }

    if (position >= 0) {
      records[position] = record;
    } else {
      index.set(identity, records.length);
      records.push(record);
    }
    results.push(record);
    changed = true;
  });

  if (changed) writeRecordsToSheet_(ctx.recordSheet, records);
  return results;
}

function recordIdentity_(record) {
  return `${record.type}|${record.key}`;
}

function compareRecordTime_(a, b) {
  return effectiveTime_(a) - effectiveTime_(b);
}

function effectiveTime_(record) {
  const value = record.deletedAt || record.updatedAt || record.createdAt || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function normalizeRecord_(raw) {
  const record = {};
  GSP_COLUMNS.forEach((column) => record[column] = raw && raw[column] != null ? String(raw[column]) : '');
  if (!record.updatedAt) record.updatedAt = new Date().toISOString();
  if (!record.threadId) {
    const match = record.key.match(/(?:^|:)thread:([^:]+)$/);
    if (match) record.threadId = match[1];
  }
  if (record.type !== 'case') {
    if (record.threadId) record.key = 'thread:' + record.threadId;
    else {
      const subjectMatch = record.key.match(/(?:^|:)subject:(.+)$/);
      if (subjectMatch) record.key = 'subject:' + subjectMatch[1];
    }
  }
  return record;
}

function rowToRecord_(row) {
  const record = {};
  GSP_COLUMNS.forEach((column, index) => record[column] = row[index] || '');
  return record;
}

function recordToRow_(record) {
  return GSP_COLUMNS.map((column) => record[column] || '');
}

function syncAllGmailLabels_(records) {
  ensureCaseRootLabel_();
  ensureStatusRootLabel_();
  const source = listRecords_(false, records);
  const cases = source.filter((record) => record.type === 'case');
  const casesById = new Map(cases.map((item) => [item.key, item]));
  const members = source.filter((record) => record.type === 'member');
  const notes = source.filter((record) => record.type === 'note');
  const notesByThread = new Map(notes.filter((item) => item.threadId).map((item) => [item.threadId, item]));
  const membersByThread = new Map(members.filter((item) => item.threadId).map((item) => [item.threadId, item]));
  const threadIds = new Set([...notesByThread.keys(), ...membersByThread.keys()]);
  let threadCount = 0;

  threadIds.forEach((threadId) => {
    const note = notesByThread.get(threadId) || null;
    const member = membersByThread.get(threadId) || null;
    const caseRecord = member?.groupId ? casesById.get(member.groupId) || null : null;
    syncThreadCaseLabel_(threadId, caseRecord);
    syncThreadStatusLabels_(threadId, note?.text || '', caseRecord?.status || '');
    threadCount += 1;
  });

  const activeCaseLabelNames = new Set(cases.map(caseLabelName_));
  GmailApp.getUserLabels().forEach((label) => {
    const name = label.getName();
    if (isManagedCaseLabelName_(name) && !activeCaseLabelNames.has(name)) GmailApp.deleteLabel(label);
  });

  return {threads: threadCount, cases: activeCaseLabelNames.size, statuses: getStatusCatalog_(source).length};
}

function syncCaseStatusLabels_(caseId, records) {
  const caseRecord = caseId ? getRecordByKey_('case', caseId, records) : null;
  if (!caseRecord) return {ok: true, labels: []};
  const members = getActiveRecords_('member', records).filter((member) => member.groupId === caseId);
  let firstError = '';
  const labels = new Set();
  members.forEach((member) => {
    const note = getRecordByConversation_('note', member.threadId, member.subject, records);
    const result = syncThreadStatusLabels_(member.threadId, note?.text || '', caseRecord.status || '');
    result.labels.forEach((label) => labels.add(label));
    if (!result.ok && !firstError) firstError = result.error;
  });
  return {ok: !firstError, error: firstError, labels: [...labels]};
}

function syncThreadCaseLabel_(threadId, caseRecord) {
  if (!threadId) return {ok: false, error: 'threadId mancante', label: ''};
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) return {ok: false, error: 'thread Gmail non trovato', label: ''};

    thread.getLabels().forEach((label) => {
      if (isManagedCaseLabelName_(label.getName())) thread.removeLabel(label);
    });

    if (caseRecord) {
      const label = ensureCaseLabel_(caseRecord);
      thread.addLabel(label);
      return {ok: true, label: label.getName()};
    }
    return {ok: true, label: ''};
  } catch (error) {
    console.warn(`GSP: impossibile sincronizzare label case per ${threadId}: ${error}`);
    return {ok: false, error: String(error && error.message ? error.message : error), label: ''};
  }
}

function syncThreadStatusLabels_(threadId, conversationStatus, caseStatus) {
  if (!threadId) return {ok: false, error: 'threadId mancante', labels: []};
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) return {ok: false, error: 'thread Gmail non trovato', labels: []};

    thread.getLabels().forEach((label) => {
      if (isManagedStatusLabelName_(label.getName())) thread.removeLabel(label);
    });

    const wanted = new Map();
    [conversationStatus, caseStatus].forEach((status) => {
      const clean = cleanStatus_(status);
      if (clean) wanted.set(clean.toLocaleLowerCase('it'), clean);
    });

    const labels = [];
    wanted.forEach((status) => {
      const label = ensureStatusLabel_(status);
      thread.addLabel(label);
      labels.push(label.getName());
    });
    return {ok: true, labels};
  } catch (error) {
    console.warn(`GSP: impossibile sincronizzare label stato per ${threadId}: ${error}`);
    return {ok: false, error: String(error && error.message ? error.message : error), labels: []};
  }
}

function ensureCaseRootLabel_() {
  return GmailApp.getUserLabelByName(GSP_CASE_LABEL_ROOT) || GmailApp.createLabel(GSP_CASE_LABEL_ROOT);
}

function ensureStatusRootLabel_() {
  return GmailApp.getUserLabelByName(GSP_STATUS_LABEL_ROOT) || GmailApp.createLabel(GSP_STATUS_LABEL_ROOT);
}

function ensureCaseLabel_(caseRecord) {
  ensureCaseRootLabel_();
  const name = caseLabelName_(caseRecord);
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function ensureStatusLabel_(status) {
  ensureStatusRootLabel_();
  const name = statusLabelName_(status);
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function deleteCaseLabel_(caseRecord) {
  const label = GmailApp.getUserLabelByName(caseLabelName_(caseRecord));
  if (label) GmailApp.deleteLabel(label);
}

function caseLabelName_(caseRecord) {
  const rawName = caseRecord && (caseRecord.name || caseRecord.key) ? (caseRecord.name || caseRecord.key) : 'Senza nome';
  const cleanName = String(rawName)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\/+|\/+$/g, '')
    .trim() || 'Senza nome';
  return `${GSP_CASE_LABEL_ROOT}/${cleanName}`;
}

function statusLabelName_(status) {
  const clean = cleanStatus_(status) || 'Senza stato';
  return `${GSP_STATUS_LABEL_ROOT}/${clean}`;
}

function cleanStatus_(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function isManagedCaseLabelName_(name) {
  return String(name || '').startsWith(GSP_CASE_LABEL_ROOT + '/');
}

function isManagedStatusLabelName_(name) {
  return String(name || '').startsWith(GSP_STATUS_LABEL_ROOT + '/');
}

function getStringInput_(e, fieldName) {
  const input = e?.commonEventObject?.formInputs?.[fieldName];
  return input?.stringInputs?.value?.[0] || '';
}

function getDateInputIso_(e, fieldName) {
  const input = e?.commonEventObject?.formInputs?.[fieldName]?.dateInput;
  if (!input || !input.msSinceEpoch) return '';
  const date = new Date(Number(input.msSinceEpoch));
  if (Number.isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function dateIsoToMs_(iso) {
  return Date.parse(iso + 'T12:00:00Z');
}

function formatDateTime_(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function normalizeSubject_(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactText_(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function buildGmailSearchUrl_(subject) {
  return 'https://mail.google.com/mail/#search/' + encodeURIComponent('subject:"' + String(subject || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
}

function escapeMarkdownLabel_(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function isValidSyncToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('GSP_SYNC_TOKEN');
  return !!expected && String(token || '') === expected;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function updateCardResponse_(card, stateChanged) {
  const response = CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card));
  if (stateChanged) response.setStateChanged(true);
  return response.build();
}

function updateCardResponseWithNotification_(card, message, stateChanged) {
  const response = CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .setNotification(CardService.newNotification().setText(message));
  if (stateChanged) response.setStateChanged(true);
  return response.build();
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
