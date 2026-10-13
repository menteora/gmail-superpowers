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

function gspSaveEmailByKey_(key, patch) {
  const storage = loadStorageSnapshot_();
  const existing = ['member','note','deadline'].map(type=>getRecordByKey_(type,key,storage.records)).filter(Boolean);
  if(!existing.length)throw new Error('Email non trovata');
  const keys=Object.keys(patch);
  if(!keys.length||keys.some(k=>!['status','notes','dueDate'].includes(k)))throw new Error('Campi non validi');
  const base=existing[0],now=new Date().toISOString();
  const note=getRecordByKey_('note',key,storage.records)||{type:'note',key,account:base.account,threadId:base.threadId,subject:base.subject,createdAt:now};
  const deadline=getRecordByKey_('deadline',key,storage.records)||{type:'deadline',key,account:base.account,threadId:base.threadId,subject:base.subject,createdAt:now};
  if('status' in patch){if(typeof patch.status!=='string'||patch.status.length>180)throw new Error('Stato non valido');note.text=patch.status.trim();}
  if('notes' in patch){if(typeof patch.notes!=='string'||patch.notes.length>12000)throw new Error('Note non valide');note.notes=patch.notes.trim();}
  if('dueDate' in patch){if(typeof patch.dueDate!=='string'||(patch.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate)))throw new Error('Scadenza non valida');deadline.dueDate=patch.dueDate;}
  note.updatedAt=now;deadline.updatedAt=now;
  const byId=new Map(storage.records.map((r,i)=>[recordIdentity_(r),i]));
  [note,deadline].forEach(r=>{const id=recordIdentity_(r);if(byId.has(id))storage.records[byId.get(id)]=r;else storage.records.push(r);});
  writeRecordsToSheet_(storage.recordSheet,storage.records);
  refreshDashboard_(storage.ss,storage.records,storage.dashboardSheet);
  if('status' in patch&&base.threadId)syncThreadStatusLabels_(base.threadId,note.text||'');
  return {ok:true};
}
