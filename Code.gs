const GSP_VERSION = '0.2.0';
const GSP_RECORD_SHEET = 'records';
const GSP_LABEL_ROOT = 'gs';
const GSP_COLUMNS = [
  'type', 'key', 'account', 'threadId', 'subject', 'text', 'dueDate',
  'groupId', 'name', 'status', 'url', 'lastEmailLabel', 'lastEmailAt',
  'createdAt', 'updatedAt', 'deletedAt'
];

function onHomepage(e) {
  return [buildHomeCard_()];
}

function onGmailMessageOpen(e) {
  ensureStorage_();
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
  ensureStorage_();
  const result = syncAllCaseLabels_();
  return updateCardResponseWithNotification_(
    buildHomeCard_(),
    `Label Gmail sincronizzate: ${result.threads} conversazioni, ${result.labels} case.`
  );
}

function saveConversation(e) {
  ensureStorage_();
  const params = (e.commonEventObject && e.commonEventObject.parameters) || {};
  const threadId = params.threadId || '';
  const subject = params.subject || '';
  const lastEmailAt = params.lastEmailAt || '';
  const lastEmailLabel = params.lastEmailLabel || '';
  const state = getConversationState_(threadId, subject);
  const now = new Date().toISOString();
  const key = state.member?.key || state.note?.key || state.deadline?.key || `addon:thread:${threadId}`;
  const account = state.member?.account || state.note?.account || state.deadline?.account || 'addon';

  const status = getStringInput_(e, 'status');
  const dueDate = getDateInputIso_(e, 'dueDate');
  const selectedCaseId = getStringInput_(e, 'caseId');
  const newCaseName = getStringInput_(e, 'newCaseName').trim();
  const caseStatus = getStringInput_(e, 'caseStatus').trim();

  let groupId = selectedCaseId || '';
  if (newCaseName) {
    groupId = Utilities.getUuid();
    upsertRecord_({
      type: 'case', key: groupId, account, name: newCaseName, status: caseStatus,
      createdAt: now, updatedAt: now
    });
  } else if (groupId) {
    const currentCase = getRecordByKey_('case', groupId);
    if (currentCase) {
      upsertRecord_(Object.assign({}, currentCase, {status: caseStatus, updatedAt: now, deletedAt: ''}));
    }
  }

  upsertRecord_({
    type: 'note', key, account, threadId, subject, text: status,
    updatedAt: now, deletedAt: ''
  });
  upsertRecord_({
    type: 'deadline', key, account, threadId, subject, dueDate,
    updatedAt: now, deletedAt: ''
  });
  upsertRecord_({
    type: 'member', key, account, threadId, subject, groupId,
    url: buildGmailSearchUrl_(subject), lastEmailLabel, lastEmailAt,
    updatedAt: now, deletedAt: ''
  });

  const caseRecord = groupId ? getRecordByKey_('case', groupId) : null;
  syncThreadCaseLabel_(threadId, caseRecord);

  return updateCardResponse_(buildConversationCard_({threadId, subject, lastEmailAt, lastEmailLabel}));
}

function removeCaseAction(e) {
  ensureStorage_();
  const params = (e.commonEventObject && e.commonEventObject.parameters) || {};
  const caseId = params.caseId || '';
  const context = {
    threadId: params.threadId || '',
    subject: params.subject || '',
    lastEmailAt: params.lastEmailAt || '',
    lastEmailLabel: params.lastEmailLabel || ''
  };
  const caseRecord = caseId ? getRecordByKey_('case', caseId) : null;
  if (!caseRecord) return updateCardResponse_(buildConversationCard_(context));

  const now = new Date().toISOString();
  const members = getActiveRecords_('member').filter((member) => member.groupId === caseId);
  members.forEach((member) => {
    upsertRecord_(Object.assign({}, member, {groupId: '', updatedAt: now, deletedAt: ''}));
    syncThreadCaseLabel_(member.threadId, null);
  });

  upsertRecord_(Object.assign({}, caseRecord, {updatedAt: now, deletedAt: now}));
  deleteCaseLabel_(caseRecord);

  return updateCardResponseWithNotification_(
    buildConversationCard_(context),
    `Caso rimosso: ${caseRecord.name || caseRecord.key}`
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
    section.addWidget(CardService.newKeyValue().setTopLabel('Storage').setContent(ss.getName()));
    section.addWidget(CardService.newTextButton().setText('Apri Google Sheet').setOpenLink(CardService.newOpenLink().setUrl(ss.getUrl())));
    section.addWidget(CardService.newTextButton()
      .setText('Sincronizza label Gmail')
      .setOnClickAction(CardService.newAction().setFunctionName('syncGmailLabelsAction')));
  }
  card.addSection(section);
  return card.build();
}

function buildConversationCard_(context) {
  const state = getConversationState_(context.threadId, context.subject);
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
  form.addWidget(CardService.newTextInput().setFieldName('status').setTitle('Stato').setValue(state.note?.text || ''));

  const picker = CardService.newDatePicker().setFieldName('dueDate').setTitle('Scadenza');
  if (state.deadline?.dueDate) picker.setValueInMsSinceEpoch(dateIsoToMs_(state.deadline.dueDate));
  form.addWidget(picker);

  const cases = getActiveRecords_('case').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const selection = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('caseId');
  selection.addItem('Nessun caso', '', !state.member?.groupId);
  cases.forEach((item) => selection.addItem(item.name || item.key, item.key, item.key === state.member?.groupId));
  form.addWidget(selection);
  form.addWidget(CardService.newTextInput().setFieldName('newCaseName').setTitle('Nuovo caso').setHint('Se compilato, crea un nuovo caso e collega questa conversazione'));
  form.addWidget(CardService.newTextInput().setFieldName('caseStatus').setTitle('Stato del caso').setValue(state.caseRecord?.status || ''));

  const save = CardService.newTextButton()
    .setText('Salva')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('saveConversation').setParameters({
      threadId: context.threadId || '',
      subject: context.subject || '',
      lastEmailAt: context.lastEmailAt || '',
      lastEmailLabel: context.lastEmailLabel || ''
    }));
  form.addWidget(save);
  card.addSection(form);

  if (state.caseRecord) {
    const related = CardService.newCardSection().setHeader('Caso: ' + (state.caseRecord.name || ''));
    const members = getActiveRecords_('member').filter((member) => member.groupId === state.caseRecord.key);
    if (!members.length) {
      related.addWidget(CardService.newTextParagraph().setText('Nessuna conversazione collegata.'));
    } else {
      members.forEach((member) => {
        const note = getRecordByConversation_('note', member.threadId, member.subject);
        const deadline = getRecordByConversation_('deadline', member.threadId, member.subject);
        const details = [];
        if (member.lastEmailAt || member.lastEmailLabel) details.push('ultima email ' + (member.lastEmailLabel || formatDateTime_(member.lastEmailAt)));
        if (deadline?.dueDate) details.push('scade ' + deadline.dueDate);
        if (note?.text) details.push('stato: ' + note.text);
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

function doGet(e) {
  const token = e && e.parameter ? e.parameter.token : '';
  if (!isValidSyncToken_(token)) return json_({ok: false, error: 'unauthorized'});
  return json_({ok: true, version: GSP_VERSION, storage: !!PropertiesService.getScriptProperties().getProperty('GSP_STORAGE_SPREADSHEET_ID')});
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (!isValidSyncToken_(body.token)) return json_({ok: false, error: 'unauthorized'});
    ensureStorage_();
    if (body.action === 'ping') return json_({ok: true, version: GSP_VERSION});
    if (body.action !== 'sync') return json_({ok: false, error: 'unsupported_action'});

    const incoming = Array.isArray(body.records) ? body.records : [];
    mergeRecords_(incoming);
    return json_({ok: true, version: GSP_VERSION, records: listRecords_(true)});
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
  ensureRecordSheet_(spreadsheet);
  if (!props.getProperty('GSP_SYNC_TOKEN')) rotateSyncToken();
  const result = {
    spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
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
  const ss = SpreadsheetApp.openById(props.getProperty('GSP_STORAGE_SPREADSHEET_ID'));
  ensureRecordSheet_(ss);
  return ss;
}

function ensureRecordSheet_(ss) {
  let sheet = ss.getSheetByName(GSP_RECORD_SHEET);
  if (!sheet) sheet = ss.insertSheet(GSP_RECORD_SHEET);
  const firstRow = sheet.getRange(1, 1, 1, GSP_COLUMNS.length).getValues()[0];
  if (firstRow.join('|') !== GSP_COLUMNS.join('|')) {
    sheet.getRange(1, 1, 1, GSP_COLUMNS.length).setValues([GSP_COLUMNS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function listRecords_(includeDeleted) {
  const ss = ensureStorage_();
  const sheet = ensureRecordSheet_(ss);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, GSP_COLUMNS.length).getDisplayValues();
  return values.map(rowToRecord_).filter((record) => record.type && record.key && (includeDeleted || !record.deletedAt));
}

function getActiveRecords_(type) {
  return listRecords_(false).filter((record) => record.type === type);
}

function getRecordByKey_(type, key) {
  return listRecords_(false).find((record) => record.type === type && record.key === key) || null;
}

function getRecordByConversation_(type, threadId, subject) {
  const normalized = normalizeSubject_(subject);
  return listRecords_(false).find((record) => {
    if (record.type !== type) return false;
    if (threadId && (record.threadId === threadId || record.key === 'thread:' + threadId || record.key.endsWith(':thread:' + threadId))) return true;
    return normalized && normalizeSubject_(record.subject) === normalized;
  }) || null;
}

function getConversationState_(threadId, subject) {
  const note = getRecordByConversation_('note', threadId, subject);
  const deadline = getRecordByConversation_('deadline', threadId, subject);
  const member = getRecordByConversation_('member', threadId, subject);
  const caseRecord = member && member.groupId ? getRecordByKey_('case', member.groupId) : null;
  return {note, deadline, member, caseRecord};
}

function mergeRecords_(records) {
  records.forEach((raw) => {
    const record = normalizeRecord_(raw);
    if (!record.type || !record.key) return;
    upsertRecord_(record);
  });
}

function upsertRecord_(raw) {
  const record = normalizeRecord_(raw);
  const ss = ensureStorage_();
  const sheet = ensureRecordSheet_(ss);
  const lastRow = sheet.getLastRow();
  let targetRow = -1;
  let existing = null;

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, GSP_COLUMNS.length).getDisplayValues();
    for (let i = 0; i < values.length; i++) {
      const candidate = rowToRecord_(values[i]);
      if (candidate.type === record.type && candidate.key === record.key) {
        targetRow = i + 2;
        existing = candidate;
        break;
      }
    }
  }

  if (existing && compareRecordTime_(record, existing) < 0) return existing;
  const row = recordToRow_(record);
  if (targetRow > 0) sheet.getRange(targetRow, 1, 1, GSP_COLUMNS.length).setValues([row]);
  else sheet.appendRow(row);
  return record;
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

function syncAllCaseLabels_() {
  ensureRootLabel_();
  const cases = getActiveRecords_('case');
  const casesById = new Map(cases.map((item) => [item.key, item]));
  const members = getActiveRecords_('member');
  let threadCount = 0;

  members.forEach((member) => {
    if (!member.threadId) return;
    const caseRecord = member.groupId ? casesById.get(member.groupId) || null : null;
    syncThreadCaseLabel_(member.threadId, caseRecord);
    threadCount += 1;
  });

  const activeLabelNames = new Set(cases.map(caseLabelName_));
  GmailApp.getUserLabels().forEach((label) => {
    const name = label.getName();
    if (isManagedCaseLabelName_(name) && !activeLabelNames.has(name)) {
      GmailApp.deleteLabel(label);
    }
  });

  return {threads: threadCount, labels: activeLabelNames.size};
}

function syncThreadCaseLabel_(threadId, caseRecord) {
  if (!threadId) return;
  let thread;
  try {
    thread = GmailApp.getThreadById(threadId);
  } catch (error) {
    console.warn(`GSP: thread non accessibile ${threadId}: ${error}`);
    return;
  }
  if (!thread) return;

  thread.getLabels().forEach((label) => {
    if (isManagedCaseLabelName_(label.getName())) thread.removeLabel(label);
  });

  if (caseRecord) thread.addLabel(ensureCaseLabel_(caseRecord));
}

function ensureRootLabel_() {
  return GmailApp.getUserLabelByName(GSP_LABEL_ROOT) || GmailApp.createLabel(GSP_LABEL_ROOT);
}

function ensureCaseLabel_(caseRecord) {
  ensureRootLabel_();
  const name = caseLabelName_(caseRecord);
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
  return `${GSP_LABEL_ROOT}/${cleanName}`;
}

function isManagedCaseLabelName_(name) {
  return String(name || '').startsWith(GSP_LABEL_ROOT + '/');
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

function updateCardResponse_(card) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

function updateCardResponseWithNotification_(card, message) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .setNotification(CardService.newNotification().setText(message))
    .build();
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
