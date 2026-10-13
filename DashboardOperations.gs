function gspDetachByKey_(key) {
  const storage = loadStorageSnapshot_();
  const member = getRecordByKey_('member', key, storage.records);
  if (!member) throw new Error('Email non trovata');
  return gspDetachConversation_(member.threadId, member.subject);
}
