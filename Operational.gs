// Native Sheets operational model. Archive payloads are lossless JSON snapshots.
const GSP_ARCHIVE_SHEET = 'archivio';
const GSP_ARCHIVE_RECORDS = '_archivio_dati';
const GSP_ARCHIVE_COLUMNS = ['Chiuso il', 'Tipo', 'Caso / Email', 'N. email', 'Ultima email', 'ID archivio'];
function gspEnsureArchiveSheet_(ss) {
  let sheet = ss.getSheetByName(GSP_ARCHIVE_SHEET);
  if (!sheet) sheet = ss.insertSheet(GSP_ARCHIVE_SHEET);
  sheet.getRange(1,1,1,GSP_ARCHIVE_COLUMNS.length).setValues([GSP_ARCHIVE_COLUMNS])
    .setFontWeight('bold').setBackground('#e8f0fe');
  sheet.setFrozenRows(1);
  [160,120,340,100,170,290].forEach((w,i)=>sheet.setColumnWidth(i+1,w));
  return sheet;
}
function gspEnsureArchiveRecords_(ss) {
  let sheet = ss.getSheetByName(GSP_ARCHIVE_RECORDS);
  if (!sheet) sheet = ss.insertSheet(GSP_ARCHIVE_RECORDS);
  sheet.getRange(1,1,1,5).setValues([['id','type','name','archivedAt','payload']]);
  if (!sheet.isSheetHidden()) sheet.hideSheet();
  return sheet;
}
function gspReadArchive_(ss) {
  const sheet = gspEnsureArchiveRecords_(ss);
  if (sheet.getLastRow()<2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,5).getValues()
    .filter(r=>r[0]).map(r=>({id:String(r[0]),type:String(r[1]),name:String(r[2]),at:String(r[3]),records:JSON.parse(String(r[4]))}));
}
function gspWriteArchive_(ss, entries) {
  const sheet = gspEnsureArchiveRecords_(ss);
  const data = entries.map(v=>[v.id,v.type,v.name,v.at,JSON.stringify(v.records)]);
  const old=Math.max(0,sheet.getLastRow()-1);
  if(sheet.getMaxRows()<data.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),data.length+1-sheet.getMaxRows());
  if(data.length)sheet.getRange(2,1,data.length,5).setValues(data);
  if(old>data.length)sheet.getRange(data.length+2,1,old-data.length,5).clearContent();
}
function gspRefreshArchive_(ss) {
  const sheet=gspEnsureArchiveSheet_(ss);
  const entries=gspReadArchive_(ss);
  const rows=entries.map(a=>{
    const members=a.records.filter(r=>r.type==='member');
    const latest=members.reduce((max,r)=>r.lastEmailAt>max?r.lastEmailAt:max,'');
    return [a.at,a.type==='case'?'Caso':'Email',a.name,members.length,latest,a.id];
  });
  const old=Math.max(0,sheet.getLastRow()-1);
  if(sheet.getMaxRows()<rows.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
  if(rows.length)sheet.getRange(2,1,rows.length,6).setValues(rows);
  if(old>rows.length)sheet.getRange(rows.length+2,1,old-rows.length,6).clearContent();
}
function gspMigrateLegacyStatuses_(records, sheet) {
  let changed=false;
  records.forEach(r=>{
    if(r.type!=='case')return;
    if(r.status) {
      if(!r.notes)r.notes='Stato precedente del caso: '+r.status;
      r.status='';
      changed=true;
    }
  });
  if(changed)writeRecordsToSheet_(sheet,records);
}
function gspRefreshDashboard_(spreadsheet, records, dashboardSheet) {
  const ss=spreadsheet||ensureStorage_();
  const sheet=dashboardSheet||getDashboardSheet_(ss);
  const active=listRecords_(false,records||readRecordsFromSheet_(getRecordSheet_(ss)));
  const cases=active.filter(r=>r.type==='case');
  const members=active.filter(r=>r.type==='member');
  const notes=active.filter(r=>r.type==='note');
  const deadlines=active.filter(r=>r.type==='deadline');
  const byKey=new Map();
  const get=(type,m)=> {
    const pool=type==='note'?notes:deadlines;
    return pool.find(r=>(m.threadId&&r.threadId===m.threadId)||(m.key&&r.key===m.key))||null;
  };
  const toDetail=m=>{
    const note=get('note',m);const due=get('deadline',m);
    return [m.subject||'(senza oggetto)',note?.text||'',due?.dueDate||'',m.lastEmailAt||''].filter(Boolean).join(' · ');
  };
  const rows=[];
  const ids=new Set(cases.map(c=>c.key));
  cases.sort((a,b)=>a.name.localeCompare(b.name,'it')).forEach(c=>{
    const linked=members.filter(m=>m.groupId===c.key);
    const d=linked.map(m=>get('deadline',m)?.dueDate||'').filter(Boolean).sort()[0]||'';
    const last=linked.map(m=>m.lastEmailAt||'').sort().reverse()[0]||'';
    const statuses=[...new Set(linked.map(m=>get('note',m)?.text||'').filter(Boolean))].join(' · ');
    rows.push(['Caso',c.name,linked.length,statuses,d,last,linked.map(toDetail).join('\n'),linked[0]?.url||'',c.key]);
  });
  members.filter(m=>!m.groupId||!ids.has(m.groupId)).forEach(m=>{
    rows.push(['Email',m.subject||'',1,get('note',m)?.text||'',get('deadline',m)?.dueDate||'',m.lastEmailAt||'',toDetail(m),m.url||'',m.key]);
  });
  const memberKeys=new Set(members.map(m=>m.key));
  notes.filter(n=>!memberKeys.has(n.key)).forEach(n=>{
    rows.push(['Email',n.subject||'',1,n.text||'',deadlines.find(d=>d.key===n.key)?.dueDate||'','',n.notes||'',buildGmailSearchUrl_(n.subject||''),n.key]);
  });
  deadlines.filter(d=>!memberKeys.has(d.key)&&!notes.some(n=>n.key===d.key)).forEach(d=>{
    rows.push(['Email',d.subject||'',1,'',d.dueDate||'','','',buildGmailSearchUrl_(d.subject||''),d.key]);
  });
  const old=Math.max(0,sheet.getLastRow()-1);
  if(sheet.getMaxRows()<rows.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
  if(rows.length)sheet.getRange(2,1,rows.length,GSP_DASHBOARD_COLUMNS.length).setValues(rows).setVerticalAlignment('top').setWrap(true);
  if(old>rows.length)sheet.getRange(rows.length+2,1,old-rows.length,GSP_DASHBOARD_COLUMNS.length).clearContent();
  const filter=sheet.getFilter();if(filter)filter.remove();
  if(rows.length)sheet.getRange(1,1,rows.length+1,GSP_DASHBOARD_COLUMNS.length).createFilter();
  return {rows:rows.length,sheetId:sheet.getSheetId()};
}
function gspSaveArchive_(storage,type,name,selected) {
  const archive=gspReadArchive_(storage.ss);
  const now=new Date().toISOString(),id=Utilities.getUuid();
  const entry={id,type,name,at:now,records:selected.map(r=>Object.assign({},r))};
  archive.push(entry);
  gspWriteArchive_(storage.ss,archive);
  const identities=new Set(selected.map(r=>recordIdentity_(r)));
  const remaining=storage.records.filter(r=>!identities.has(recordIdentity_(r)));
  writeRecordsToSheet_(storage.recordSheet,remaining);
  storage.records.splice(0,storage.records.length,...remaining);
  refreshDashboard_(storage.ss,storage.records,storage.dashboardSheet);
  gspRefreshArchive_(storage.ss);
  return {conversations:selected.filter(r=>r.type==='member').length,id};
}
function gspArchiveCase_(caseId) {
  const ctx=loadStorageSnapshot_();
  const rec=getRecordByKey_('case',caseId,ctx.records);
  if(!rec)throw new Error('Caso non trovato');
  const members=getActiveRecords_('member',ctx.records).filter(m=>m.groupId===caseId);
  const keys=new Set(members.map(m=>m.key));
  const selected=ctx.records.filter(r=>(r.type==='case'&&r.key===caseId)||(r.type!=='case'&&keys.has(r.key)));
  const done=gspSaveArchive_(ctx,'case',rec.name,selected);
  members.forEach(m=>{syncThreadCaseLabel_(m.threadId,null);syncThreadStatusLabels_(m.threadId,'');});
  const stillNamed=getActiveRecords_('case',ctx.records).some(c=>caseLabelName_(c)===caseLabelName_(rec));
  if(!stillNamed)deleteCaseLabel_(rec);
  return done;
}
function gspArchiveConversation_(threadId,subject) {
  const ctx=loadStorageSnapshot_();
  const state=getConversationState_(threadId,subject,ctx.records);
  const keys=new Set([state.member?.key,state.note?.key,state.deadline?.key].filter(Boolean));
  if(!keys.size)throw new Error('Conversazione non trovata');
  const selected=ctx.records.filter(r=>r.type!=='case'&&keys.has(r.key));
  const done=gspSaveArchive_(ctx,'email',subject||'(senza oggetto)',selected);
  syncThreadCaseLabel_(threadId,null);syncThreadStatusLabels_(threadId,'');
  return done;
}
function gspDetachConversation_(threadId,subject) {
  const ctx=loadStorageSnapshot_();
  const member=getRecordByConversation_('member',threadId,subject,ctx.records);
  if(!member||!member.groupId)return {changed:false};
  member.groupId='';member.updatedAt=new Date().toISOString();
  writeRecordsToSheet_(ctx.recordSheet,ctx.records);
  refreshDashboard_(ctx.ss,ctx.records,ctx.dashboardSheet);
  syncThreadCaseLabel_(threadId,null);
  return {changed:true};
}
function gspRestoreArchive_(id) {
  const ctx=loadStorageSnapshot_();
  const archive=gspReadArchive_(ctx.ss);
  const selected=archive.find(a=>a.id===id);
  if(!selected)throw new Error('Archivio non trovato');
  const used=new Set(ctx.records.map(recordIdentity_));
  const overlap=selected.records.find(r=>used.has(recordIdentity_(r)));
  if(overlap)throw new Error('Esistono già dati operativi con lo stesso identificativo: ripristino bloccato');
  const remaining=archive.filter(a=>a.id!==id);
  // Write operational records first; keep the archive intact if that write fails.
  const restored=ctx.records.concat(selected.records);
  writeRecordsToSheet_(ctx.recordSheet,restored);
  gspWriteArchive_(ctx.ss,remaining);
  refreshDashboard_(ctx.ss,restored,ctx.dashboardSheet);
  gspRefreshArchive_(ctx.ss);
  const caseRecord=selected.records.find(r=>r.type==='case');
  selected.records.filter(r=>r.type==='member').forEach(m=>{
    syncThreadCaseLabel_(m.threadId,caseRecord||null);
    const note=selected.records.find(r=>r.type==='note'&&r.key===m.key);
    syncThreadStatusLabels_(m.threadId,note?.text||'');
  });
  return selected;
}
