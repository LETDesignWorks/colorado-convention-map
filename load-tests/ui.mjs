import {STATUSES,ROLES,uid,copy,dateText,newTest,blankSite,blankContact,blankTask,duplicateTest,moveDate,progress,validateTest} from './model.mjs?v=20261019-3';
import {escapeHtml as e,reportHtml} from './report.mjs';
import {workbookFor} from './workbook.mjs?v=20261019-3';
import {scheduleHtml,workbookHtml,sampleHtml} from './workbook-ui.mjs?v=20261019-3';
import {makeChecklistPdf} from './checklist-pdf.mjs?v=20261019-3';

export async function mount(store){
  const app=document.getElementById('app'),notice=document.getElementById('notice');
  let user=null,records=[],test=null,siteId='overall',revision=0,dirty=false,saving=false,ready=false,showArchived=false,remoteConflict=false;
  let search='',roleFilter='',statusFilter='',creationMode='new',importMode='copy',templates=[],noticeTimer;
  try{const response=await fetch(new URL('./template.json',import.meta.url));if(response.ok)templates=await response.json();}catch{}
  const byId=id=>document.getElementById(id);
  const group=()=>siteId==='overall'?test.overall:test.sites.find(s=>s.id===siteId);
  const flash=(message,error=false)=>{notice.textContent=message;notice.className=`visible${error?' error':''}`;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.className='',error?18000:7000);};
  const errorMessage=error=>error.code==='permission-denied'?'This account cannot access the shared checklists. Sign in with the website’s planning administrator account.':error.code?.startsWith('auth/')?'Sign-in was unsuccessful. Check your existing website email and password, then try again.':error.message||'The operation could not be completed. Try again.';
  const options=(items,value)=>items.map(v=>`<option value="${e(v)}"${v===value?' selected':''}>${e(v||'All')}</option>`).join('');
  function field(label,key,value,kind='site',id='',type='text',wide=false){return `<label${wide?' class="wide"':''}>${e(label)}<input type="${type}" value="${e(value)}" data-kind="${kind}" data-id="${e(id)}" data-field="${key}" maxlength="${key==='phone'?100:1000}"></label>`;}
  function area(label,key,value,kind='site',id='',rows=3){return `<label class="wide">${e(label)}<textarea rows="${rows}" data-kind="${kind}" data-id="${e(id)}" data-field="${key}" maxlength="${key==='title'?4000:8000}">${e(value)}</textarea></label>`;}
  function select(label,key,value,items,kind,id=''){return `<label>${e(label)}<select aria-label="${e(label)}" data-kind="${kind}" data-id="${e(id)}" data-field="${key}">${options([...new Set([...items,value])],value)}</select></label>`;}
  function markDirty(){dirty=true;updateSave();updateProgress();}
  function updateSave(){
    const state=byId('save-state');if(state){state.textContent=saving?'Saving shared checklist…':remoteConflict?'Newer shared changes available. Back up your edits, then reload.':dirty?'Unsaved changes':revision?'Saved to the shared workspace':'New checklist — save to share';state.className=`save-state${dirty?' dirty':''}`;}
    if(byId('save'))byId('save').disabled=saving||!dirty;
    if(byId('reload'))byId('reload').disabled=saving||!records.some(r=>r.test.id===test?.id);
    ['saved-test','new-test','duplicate-test','import','archive'].forEach(id=>{if(byId(id))byId(id).disabled=saving;});
  }
  function updateProgress(){if(!test)return;const p=progress(test);if(byId('progress-count'))byId('progress-count').textContent=`${p.done} / ${p.total}`;if(byId('help-count'))byId('help-count').textContent=p.help?`${p.help} item${p.help===1?'':'s'} need help`:'Keep each assignment confirmed and ready.';if(byId('progress-bar'))byId('progress-bar').style.width=`${p.total?p.done/p.total*100:0}%`;renderLocations();}
  function guard(){return !dirty||confirm('You have unsaved changes. Discard them and continue?');}
  function load(record){test=copy(record.test);revision=record.revision;dirty=false;remoteConflict=false;siteId='overall';search='';roleFilter='';statusFilter='';render();}
  function header(){return `${store.preview?'<div class="preview-banner">LOCAL PREVIEW · Sample data only. Saves here do not change the shared website.</div>':''}<div class="hero"><div><div class="eyebrow">FIELD SERVICE · DENVER 2027</div><h1>Load test planner</h1><p class="muted">Bring the people, locations, and details together. Prepare the checklist, confirm each assignment, and keep a clear record for the next test.</p></div><span class="shared-pill">${user?.canEdit?'Shared planning workspace':'Existing website sign-in'}</span></div>`;}
  function render(){
    byId('signout').hidden=!user;
    if(!user?.canEdit){app.innerHTML=header()+`<section class="panel login"><div class="eyebrow">PRIVATE CHECKLISTS</div><h2>${user?'Planning access required':'Sign in to continue'}</h2><p class="muted" style="margin-top:12px">${user?'This account does not have the website’s existing administrator access. Sign out and use your planning account.':'Use the same account you use for the Territory Planner. Saved tests and contact details are available after sign-in.'}</p>${!user?'<form id="login-form"><label>Email<input id="email" type="email" autocomplete="username" required></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><button class="primary" id="login" type="submit">Sign in</button></form>':''}</section>`;return;}
    app.innerHTML=header()+`<section class="toolbar" aria-label="Saved load tests"><label class="saved-picker">Saved tests<select id="saved-test"></select></label><label class="check"><input id="show-archived" type="checkbox"${showArchived?' checked':''}>Include archived</label><button id="new-test">New test</button><button id="duplicate-test"${!test?' disabled':''}>Copy for future test</button><button id="import">Import file</button><button id="update-backup">Update from backup</button><button id="paste-import">Paste checklist</button><input id="import-file" type="file" accept=".json,application/json" hidden></section><div id="workspace"></div>`;
    renderPicker();
    if(!test){byId('workspace').innerHTML=`<section class="panel empty"><div class="eyebrow">${ready?'READY WHEN YOU ARE':'CONNECTING'}</div><h2>${ready?'Start your first load test':'Loading shared checklists…'}</h2><p class="muted">${ready?'Create a reusable checklist or import your prepared October 24 checklist. Every saved test stays available for future reference.':'Your saved records will appear here.'}</p>${ready?'<button class="primary" id="start-test">New test</button>':''}</section>`;return;}
    byId('workspace').innerHTML=`<div class="layout"><aside class="sidebar"><div class="side-card"><h3>Locations</h3><div id="locations"></div></div><p class="side-note">1. Confirm contacts<br>2. Review assignments<br>3. Save changes<br>4. Print the checklist<br><br>Past tests remain separate when you make a copy.</p><button id="add-site" style="width:100%">+ Add location</button></aside><div><div class="savebar"><span id="save-state" role="status"></span><div class="button-row"><button id="reload">Reload saved</button><button class="primary" id="save">Save changes</button></div></div><div id="editor"></div><div id="sample-section">${sampleHtml(test)}</div><section class="panel"><div class="panel-head"><div><h2>Print & keep a copy</h2><p class="muted" style="margin-top:6px">Download a fillable PDF with the matching checklist design, packet examples, literature, logs and volunteer rosters. Entries made here are included in the PDF; edits made in a PDF stay in that file.</p></div></div><div class="print-tools"><label>Checklist to print<select id="print-scope"><option value="all">Complete test · all locations</option><option value="overall">Test coordination only</option>${test.sites.map(s=>`<option value="${e(s.id)}">${e(s.name)}</option>`).join('')}</select></label><button id="pdf" class="primary">Download editable PDF</button><button id="print">Open PDF to print</button></div><div class="button-row" style="justify-content:space-between;margin-top:18px"><button id="backup" class="quiet">Download editable backup</button><button id="archive" class="quiet">${test.archived?'Restore active test':'Archive this test'}</button></div></section></div></div>`;
    renderEditor();updateSave();updateProgress();
  }
  function renderPicker(){if(!byId('saved-test'))return;const available=records.filter(r=>showArchived||!r.test.archived||r.test.id===test?.id).sort((a,b)=>b.test.date.localeCompare(a.test.date));byId('saved-test').innerHTML=`<option value="">Select a saved test</option>${test&&!records.some(r=>r.test.id===test.id)?`<option value="${e(test.id)}">${e(test.name)} · unsaved draft</option>`:''}${available.map(r=>`<option value="${e(r.test.id)}">${e(dateText(r.test.date))} · ${e(r.test.name)}${r.test.archived?' (archived)':''}</option>`).join('')}`;byId('saved-test').value=test?.id||'';}
  function renderLocations(){if(!byId('locations'))return;byId('locations').innerHTML=[{id:'overall',name:'Test coordination'},...test.sites].map(s=>{const p=progress(test,s.id);return `<button class="location-button${s.id===siteId?' active':''}" data-location="${e(s.id)}"${s.id===siteId?' aria-current="true"':''}>${e(s.name)}<small>${p.done} of ${p.total} items complete</small></button>`;}).join('');}
  function renderEditor(){const g=group(),overall=siteId==='overall';
    byId('editor').innerHTML=`${test.archived?'<div class="warning">Archived test. You can still review, print, or edit this record. Use Copy for future test to start a fresh checklist.</div>':''}<section class="panel"><div class="panel-head"><div><div class="eyebrow">${overall?'THE COMPLETE TEST':'LOCATION DETAILS'}</div><h2>${e(overall?'Test coordination':g.name)}</h2></div><span class="tag">${e(dateText(test.date))}</span></div>${overall?`<div class="grid">${field('Test name','name',test.name,'test')}${field('Test date · moves checklist due dates','date',test.date,'test','','date')}${area('Overall notes & decisions','notes',test.notes,'test')}</div><div class="overview" style="margin-top:22px"><div class="progress-circle"><span id="progress-count"></span><small> complete</small></div><p id="help-count" class="muted"></p></div><div class="progress-track"><i id="progress-bar"></i></div>`:`<div class="grid">${field('Location / Kingdom Hall name','name',g.name)}${field('Kingdom Hall address','address',g.address)}${field('Host congregation(s)','hosts',g.hosts)}${field('Delegate congregation(s)','delegates',g.delegates)}${field('Congregation providing territory','territory',g.territory)}${field('Presentation language','language',g.language)}</div><details class="settings" style="margin-top:22px"><summary>Day-of schedule & planning targets</summary><div class="schedule">${field('Hall opens / hosts arrive','openTime',g.openTime,'site','','time')}${field('Delegates arrive','delegateTime',g.delegateTime,'site','','time')}${field('Meeting for service','meetingTime',g.meetingTime,'site','','time')}${field('Depart for territory','departTime',g.departTime,'site','','time')}${field('Lunch','lunchTime',g.lunchTime,'site','','time')}${field('Agreed closing time','closeTime',g.closeTime,'site','','time')}${field('Closing label (when no exact time)','closeLabel',g.closeLabel||'After lunch')}${field('Host target','hostTarget',g.hostTarget)}${field('Delegate target','delegateTarget',g.delegateTarget)}${field('Vehicles','vehicleTarget',g.vehicleTarget)}${field('Territory packets','packetTarget',g.packetTarget)}${field('Doors per packet','doorsPerPacket',g.doorsPerPacket)}${field('Tracts per packet','tractsPerPacket',g.tractsPerPacket)}</div><p class="section-note" style="margin-top:14px">Targets are planning figures. Record actual counts and agreed arrangements in the checklist.</p></details><div style="margin-top:18px">${area('Location notes, needs & concerns','notes',g.notes)}</div><div id="day-strip-wrap">${scheduleHtml(g)}</div>`}</section>
      ${overall?'':`<div id="workbook">${workbookHtml(g)}</div>`}<section class="panel"><div class="panel-head"><div><div class="eyebrow">WHO TO CONTACT</div><h2>Contacts & responsibilities</h2></div><button id="add-contact">+ Add contact</button></div><p class="section-note">${overall?'Test oversight and language coordinators.':'Keep a separate contact for each host, delegate congregation, Kingdom Hall, and territory provider. Add the opener, closer, and checkout brother as needed.'}</p><div id="contacts" class="contacts"></div></section>
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">FOLLOW THROUGH</div><h2>Checklist</h2></div><button id="add-task">+ Add item</button></div><p class="section-note">Open an item to edit the assignment, owner, due date, status, or follow-up notes. Mark unused items “Not applicable.”</p><div class="filters"><input id="task-search" type="search" aria-label="Search checklist" placeholder="Search checklist…" value="${e(search)}"><select id="role-filter" aria-label="Filter by responsibility"><option value="">All responsibilities</option>${options([...new Set([...ROLES,...g.tasks.map(t=>t.role)])],roleFilter)}</select><select id="status-filter" aria-label="Filter by status"><option value="">All statuses</option>${options(STATUSES,statusFilter)}</select></div><div id="tasks"></div></section>`;
    renderContacts();renderTasks();updateProgress();if(byId('print-scope'))byId('print-scope').value=siteId;
  }
  function renderContacts(){byId('contacts').innerHTML=group().contacts.map(c=>`<article class="contact"><div class="contact-top"><strong>${e(c.role||'Contact')}</strong><button class="quiet" data-remove-contact="${e(c.id)}">Remove contact</button></div><div class="grid three">${field('Role / responsibility','role',c.role,'contact',c.id)}${field('Congregation','congregation',c.congregation,'contact',c.id)}${field('Contact name','name',c.name,'contact',c.id)}${field('Phone','phone',c.phone,'contact',c.id,'tel')}${field('Email','email',c.email,'contact',c.id,'email')}${field('Assignment / access notes','notes',c.notes,'contact',c.id)}</div></article>`).join('')||'<p class="muted">No contacts added yet.</p>';}
  function renderTasks(openId){const opened=new Set([...document.querySelectorAll('.task[open]')].map(el=>el.dataset.task));if(openId)opened.add(openId);const tasks=group().tasks.filter(t=>(!roleFilter||t.role===roleFilter)&&(!statusFilter||t.status===statusFilter)&&(!search||[t.title,t.owner,t.notes,t.role].join(' ').toLowerCase().includes(search.toLowerCase())));
    byId('tasks').innerHTML=tasks.map(t=>`<details class="task ${t.status.toLowerCase().replaceAll(' ','-')}" data-task="${e(t.id)}"${opened.has(t.id)?' open':''}><summary><span class="status-icon" aria-hidden="true">${t.status==='Complete'?'✓':t.status==='Needs help'?'!':''}</span><span class="task-title">${e(t.title)}<span class="task-meta">${e(t.role)} · ${e(t.status)} · ${e(dateText(t.due))}${t.owner?' · '+e(t.owner):''}</span></span><span class="chevron" aria-hidden="true">›</span></summary><div class="task-content"><div class="grid">${area('Checklist item','title',t.title,'task',t.id,2)}${select('Responsibility','role',t.role,ROLES,'task',t.id)}${select('Status','status',t.status,STATUSES,'task',t.id)}${field('Assigned to','owner',t.owner,'task',t.id)}${field('Due date','due',t.due,'task',t.id,'date')}${area('Completion check','evidence',t.evidence,'task',t.id,2)}${area('Follow-up notes / needs / concerns','notes',t.notes,'task',t.id,2)}</div>${t.source?`<p class="source">Reference: ${e(t.source)}</p>`:''}</div></details>`).join('')||'<p class="muted">No items match this view.</p>';
  }
  function openCreate(mode){if(saving||!guard())return;creationMode=mode;byId('create-title').textContent=mode==='copy'?'Copy for a future test':'New load test';byId('create-name').value=mode==='copy'?`${test.name} — next test`:'Field service load test';byId('create-date').value=mode==='copy'?test.date:new Date().toLocaleDateString('en-CA');byId('keep-wrap').hidden=mode!=='copy';byId('copy-help').hidden=mode!=='copy';byId('create-dialog').showModal();}
  function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function save(){if(saving||!test)return;let validated;try{validated=validateTest(test);}catch(error){flash(errorMessage(error),true);return;}
    const current=JSON.stringify(validated);saving=true;updateSave();try{const next=await store.save(validated,revision);revision=next;dirty=JSON.stringify(validateTest(test))!==current;remoteConflict=false;const found=records.find(r=>r.test.id===test.id);if(!found)records.push({test:copy(validated),revision:next});else if(found.revision<=next){found.test=copy(validated);found.revision=next;}renderPicker();flash(dirty?'Saved. You have additional edits to save.':'Checklist saved to the shared workspace.');}catch(error){flash(errorMessage(error),true);}finally{saving=false;updateSave();}}
  app.addEventListener('input',event=>{
    const target=event.target;if(target.id==='task-search'){search=target.value;renderTasks();return;}
    if(updateWorkbook(target))return;
    if(!target.dataset.field||!test||target.type==='date'||target.tagName==='SELECT')return;updateField(target);
  });
  function updateWorkbook(target){
    if(!test||siteId==='overall'||(!target.dataset.bookField&&!target.dataset.bookCheck&&!target.dataset.bookRow))return false;
    const site=group();site.workbook=workbookFor(site);
    if(target.dataset.bookField)site.workbook.fields[target.dataset.bookField]=target.value;
    if(target.dataset.bookCheck)site.workbook.checks[target.dataset.bookCheck]=target.checked;
    if(target.dataset.bookRow)site.workbook[target.dataset.bookRow][Number(target.dataset.row)][target.dataset.column]=target.type==='checkbox'?target.checked:target.value;
    markDirty();return true;
  }
  async function exportPdf(print=false){
    const snapshot=copy(test),scope=byId('print-scope').value,wasDirty=dirty;
    const printWindow=print?window.open('about:blank','_blank'):null;
    if(print&&printWindow){printWindow.document.title='Preparing checklist';printWindow.document.body.textContent='Preparing your editable checklist…';}
    byId('pdf').disabled=true;byId('print').disabled=true;flash('Preparing the editable checklist PDF…');
    try{
      const sampleBytes=snapshot.sampleTerritory&&scope!=='overall'?await store.readAttachment(snapshot.sampleTerritory):undefined;
      const bytes=await makeChecklistPdf(snapshot,scope,wasDirty,{sampleBytes});
      if(printWindow){const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));printWindow.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),300000);flash('PDF opened. Use the PDF viewer’s Print button.');}
      else{download(bytes,`${snapshot.date}-${scope==='all'?'all-locations':scope==='overall'?'coordination':snapshot.sites.find(s=>s.id===scope).name.replace(/[^a-z0-9]+/gi,'-')}-editable-checklist.pdf`,'application/pdf');flash('Editable PDF downloaded. Save it after filling in any additional details.');}
    }catch(error){if(printWindow)printWindow.close();flash(errorMessage(error),true);}
    finally{if(byId('pdf'))byId('pdf').disabled=false;if(byId('print'))byId('print').disabled=false;}
  }
  function updateField(target){const {kind,id,field:key}=target.dataset;let obj=kind==='test'?test:kind==='site'?group():kind==='task'?group().tasks.find(t=>t.id===id):group().contacts.find(c=>c.id===id);if(!obj)return;
    if(kind==='test'&&key==='date'){try{moveDate(test,target.value);}catch(error){flash(errorMessage(error),true);target.value=test.date;return;}}else obj[key]=target.value;
    markDirty();if(kind==='site'&&['openTime','delegateTime','closeTime','closeLabel'].includes(key)&&byId('day-strip-wrap'))byId('day-strip-wrap').innerHTML=scheduleHtml(group());if(kind==='task'&&(key==='status'||key==='role'))renderTasks();
  }
  app.addEventListener('change',async event=>{const target=event.target;
    if(updateWorkbook(target))return;
    if(target.id==='sample-file'&&target.files[0]){
      const current=test,file=target.files[0],button=byId('attach-sample');button.disabled=true;
      try{
        if(file.size>10000000)throw new Error('Choose a PDF smaller than 10 MB.');
        const bytes=new Uint8Array(await file.arrayBuffer());const pdf=await globalThis.PDFLib.PDFDocument.load(bytes);
        if(pdf.getPageCount()>30)throw new Error('Choose a sample territory with 30 pages or fewer.');
        const meta=await store.saveAttachment(bytes,file.name);
        if(test!==current)throw new Error('The test changed while uploading. Select the test and attach the sample again.');
        test.sampleTerritory=meta;markDirty();byId('sample-section').innerHTML=sampleHtml(test);await save();
      }catch(error){flash(errorMessage(error),true);}finally{if(byId('attach-sample'))byId('attach-sample').disabled=false;target.value='';}return;
    }
    if(target.dataset.field){
      if(target.type==='date'||target.tagName==='SELECT')updateField(target);
      if(target.dataset.kind==='test'&&target.dataset.field==='date')renderEditor();
      if(target.dataset.kind==='task'&&!['status','role'].includes(target.dataset.field))renderTasks();
      if(target.dataset.kind==='contact'&&target.dataset.field==='role')target.closest('.contact').querySelector('strong').textContent=target.value;
      if(target.dataset.kind==='site'&&target.dataset.field==='name'){
        byId('editor').querySelector('h2').textContent=target.value;
        const option=byId('print-scope').querySelector(`option[value="${siteId}"]`);if(option)option.textContent=target.value;
      }
      return;
    }
    if(target.id==='role-filter'){roleFilter=target.value;renderTasks();}
    if(target.id==='status-filter'){statusFilter=target.value;renderTasks();}
    if(target.id==='show-archived'){showArchived=target.checked;renderPicker();}
    if(target.id==='saved-test'){const record=records.find(r=>r.test.id===target.value);if(record&&guard())load(record);else target.value=test?.id||'';}
    if(target.id==='import-file'&&target.files[0]){const file=target.files[0];try{if(file.size>750000)throw new Error('Choose a checklist backup smaller than 750 KB.');const imported=validateTest(JSON.parse(await file.text()));if(!guard())return;const existing=records.find(r=>r.test.id===imported.id);if(importMode==='update'&&(!existing||existing.test.id!==test?.id))throw new Error('Choose a backup with the same ID as the currently selected saved test.');if(existing&&importMode!=='update'){imported.id=`load-test-${uid()}`;imported.name+=' — imported copy';}test=imported;revision=importMode==='update'?existing.revision:0;dirty=true;remoteConflict=false;siteId='overall';search='';roleFilter='';statusFilter='';render();flash('Checklist imported. Review it, then save to share it.');}catch(error){flash(errorMessage(error),true);}target.value='';}
  });
  app.addEventListener('submit',async event=>{if(event.target.id!=='login-form')return;event.preventDefault();byId('login').disabled=true;const email=byId('email').value.trim(),password=byId('password').value;try{await store.login(email,password);}catch(error){flash(errorMessage(error),true);if(byId('password'))byId('password').value='';}finally{if(byId('login'))byId('login').disabled=false;}});
  app.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.addBookRow){const b=workbookFor(group()),type=button.dataset.addBookRow;if(type==='packets'){if(b.packets.length>=100){flash('This log has 100 rows. Start a separate test for more.',true);return;}b.packets.push({territory:'',leader:'',out:'',in:'',returned:false,notes:''});}else{if(b.volunteers.length>=300){flash('This roster has 300 rows. Start a separate test for more.',true);return;}b.volunteers.push({role:type,congregation:'',name:'',phone:'',responsibility:''});}group().workbook=b;markDirty();const open=[...byId('workbook').querySelectorAll('details')].map(d=>d.open);byId('workbook').innerHTML=workbookHtml(group());byId('workbook').querySelectorAll('details').forEach((d,i)=>d.open=open[i]);return;}
    if(button.dataset.location){siteId=button.dataset.location;search='';roleFilter='';statusFilter='';renderEditor();return;}
    if(button.dataset.removeContact){if(confirm('Remove this contact from the current checklist? Save changes to apply it.')){group().contacts=group().contacts.filter(c=>c.id!==button.dataset.removeContact);markDirty();renderContacts();}return;}
    switch(button.id){
      case 'new-test':case 'start-test':openCreate('new');break;
      case 'duplicate-test':openCreate('copy');break;
      case 'save':void save();break;
      case 'reload':{const record=records.find(r=>r.test.id===test.id);if(record&&guard())load(record);break;}
      case 'import':importMode='copy';byId('import-file').click();break;
      case 'update-backup':importMode='update';byId('import-file').click();break;
      case 'paste-import':byId('paste-text').value='';byId('paste-dialog').showModal();break;
      case 'add-site':{const site=blankSite(test.date,templates);test.sites.push(site);siteId=site.id;markDirty();render();break;}
      case 'add-contact':group().contacts.push(blankContact(siteId==='overall'?'Coordination':'Host'));markDirty();renderContacts();break;
      case 'add-task':{const task=blankTask(test.date,siteId==='overall'?'Coordination':roleFilter||'Host');group().tasks.push(task);statusFilter='';search='';byId('status-filter').value='';byId('task-search').value='';markDirty();renderTasks(task.id);break;}
      case 'backup':download(JSON.stringify(validateTest(test),null,2),`${test.date}-load-test.json`,'application/json');break;
      case 'archive':test.archived=!test.archived;markDirty();render();flash('Archive status changed. Save changes to share it.');break;
      case 'print':void exportPdf(true);break;
      case 'pdf':void exportPdf();break;
      case 'attach-sample':byId('sample-file').click();break;
      case 'download-sample':void store.readAttachment(test.sampleTerritory).then(bytes=>download(bytes,test.sampleTerritory.name,'application/pdf')).catch(error=>flash(errorMessage(error),true));break;
    }
  });
  byId('cancel-paste').onclick=()=>byId('paste-dialog').close();
  byId('paste-form').onsubmit=event=>{
    event.preventDefault();try{
      const imported=validateTest(JSON.parse(byId('paste-text').value));if(!guard())return;
      if(records.some(r=>r.test.id===imported.id)){imported.id=`load-test-${uid()}`;imported.name+=' — imported copy';}
      test=imported;revision=0;dirty=true;remoteConflict=false;siteId='overall';search='';roleFilter='';statusFilter='';
      byId('paste-text').value='';byId('paste-dialog').close();render();flash('Checklist imported. Review it, then save to share it.');
    }catch(error){flash(errorMessage(error),true);}
  };
  byId('cancel-create').onclick=()=>byId('create-dialog').close();
  byId('create-form').onsubmit=event=>{event.preventDefault();try{const date=byId('create-date').value,name=byId('create-name').value.trim();if(!name)throw new Error('Enter a test name.');test=creationMode==='copy'?duplicateTest(test,name,date,byId('keep-contacts').checked):newTest(date,templates);test.name=name;test=validateTest(test);revision=0;dirty=true;remoteConflict=false;siteId='overall';search='';roleFilter='';statusFilter='';byId('create-dialog').close();render();flash('New checklist ready. Update the contacts and save it to share.');}catch(error){flash(errorMessage(error),true);}};
  byId('signout').onclick=async()=>{if(!guard())return;try{await store.logout();}catch(error){flash(errorMessage(error),true);}};
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  window.addEventListener('beforeprint',()=>{if(test)byId('print-report').innerHTML=reportHtml(test,byId('print-scope')?.value||'all',dirty);});
  window.addEventListener('afterprint',()=>{document.title='Load Tests | Denver 2027';});
  store.start(session=>{user=session;test=null;records=[];revision=0;dirty=false;remoteConflict=false;ready=false;byId('print-report').innerHTML='';byId('create-dialog').close();byId('paste-text').value='';byId('paste-dialog').close();render();},next=>{
    records=next;ready=true;
    if(!test){const first=records.filter(r=>!r.test.archived).sort((a,b)=>b.test.date.localeCompare(a.test.date))[0];if(first){load(first);return;}render();return;}
    const remote=records.find(r=>r.test.id===test.id);
    if(remote&&remote.revision>revision&&!saving){if(dirty){remoteConflict=true;flash('This checklist changed on another device. Download a backup of your edits, then reload the saved version.',true);updateSave();}else{const location=siteId;load(remote);if(test.sites.some(s=>s.id===location)){siteId=location;renderEditor();}}}
    renderPicker();
  },error=>{ready=true;flash(errorMessage(error),true);if(!test){render();const empty=byId('workspace');if(empty)empty.innerHTML='<section class="panel empty"><h2>Shared checklists unavailable</h2><p>Check your connection and account access, then reload. Existing records have not been changed.</p></section>';}});
}
