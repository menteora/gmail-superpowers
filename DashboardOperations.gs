function gspDetachByKey_(key) {
  const storage = loadStorageSnapshot_();
  const member = getRecordByKey_('member', key, storage.records);
  if (!member) throw new Error('Email non trovata');
  return gspDetachConversation_(member.threadId, member.subject);
}

function gspArchiveEmailByKey_(key) {
  const storage = loadStorageSnapshot_();
  const member = getRecordByKey_('member', key, storage.records);
  const note = getRecordByKey_('note', key, storage.records);
  const deadline = getRecordByKey_('deadline', key, storage.records);
  const record = member || note || deadline;
  if (!record) throw new Error('Email non trovata');
  return gspArchiveConversation_(record.threadId, record.subject);
}
