import {PHOTO_LIMIT, createDevicePhotoStore, photoError} from './photos-model.mjs';
import {preparePhoto} from './photos-images.mjs';
import {buildPhotoPdf, publicPhotoReport} from './photos-pdf.mjs?v=parking-map-only-20261108-1';
import {sendPdfsToBuilder} from '../pdf-tools/handoff.mjs?v=packets-20261107-1';
import {PDF_NOTES_LIMIT, createPhotoReportDraftStore, photoReportScope, reportNotes, pdfPhotos, selectedOverviewPhotoId} from './photos-report-draft.mjs?v=photo-selection-20261107-1';

const escape = (value='') => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountLocationPhotos({getLocation, getSummary, getOwner, isAdmin, createSharedStore,
  createDeviceStore=createDevicePhotoStore, prepare=preparePhoto, exportPdf=buildPhotoPdf,
  createReportDraftStore=createPhotoReportDraftStore,
  openParkingPlanner, onPdfChanged=()=>{}, sendToBuilder=sendPdfsToBuilder,
  document:d=globalThis.document, window:w=globalThis.window}) {
  const host=d.createElement('section'); host.className='card location-photos'; host.id='locationPhotos';
  d.getElementById('detail').after(host);
  const style=d.createElement('link'); style.rel='stylesheet'; style.href=new URL('./photos.css?v=photo-selection-20261107-1',import.meta.url).href; d.head.append(style);
  const drafts=createReportDraftStore({getStorage:()=>w.localStorage});
  let epoch=0, identity='', mode=createSharedStore?'shared':'device', store, photos=[], urls=[], pdfUrl, busy=false, loaded=false, currentLocation, currentAdmin=false, pdfRevision=0, reportIdentity='';
  let draft={notes:'',overviewPhotoIds:{device:'',shared:''},useOnlySelectedPhotos:{device:true,shared:true},persistence:'ready'};
  const contextIdentity=()=>{const location=getLocation();return location?photoReportScope({locationId:location.id,admin:isAdmin(),owner:getOwner?.()||''}):'';};
  const active=token=>token===epoch && contextIdentity()===identity;
  const currentReport=()=>publicPhotoReport(getLocation(),getSummary?.());
  const message=(value,error=false)=>{const node=host.querySelector('[data-photo-status]');if(node){node.textContent=value;node.classList.toggle('photo-error',error);}};
  function clearPdf(){pdfRevision++;if(pdfUrl){w.URL.revokeObjectURL(pdfUrl);pdfUrl=null;}host.querySelector('[data-photo-pdf-links]')?.replaceChildren();onPdfChanged();}
  function clearUrls(){urls.forEach(url=>w.URL.revokeObjectURL(url));urls=[];clearPdf();}
  function setBusy(value){busy=value;host.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=value || el.dataset.unavailable==='true');}
  const selected=()=>photos.filter(p=>p.selected!==false);
  const useOnlySelected=()=>host.querySelector('[data-photo-selected-only]')?.checked??(draft.useOnlySelectedPhotos?.[mode]!==false);
  const included=()=>pdfPhotos(photos,useOnlySelected());
  const currentNotes=()=>String(host.querySelector('[data-photo-report-notes]')?.value??draft.notes).replace(/\r\n?/g,'\n');
  const overviewId=()=>selectedOverviewPhotoId(photos,draft.overviewPhotoIds[mode],useOnlySelected());
  function updateNotesState(){
    const count=host.querySelector('[data-photo-notes-count]');
    if(count)count.textContent=`${currentNotes().length.toLocaleString('en-US')} / ${PDF_NOTES_LIMIT.toLocaleString('en-US')} characters`;
    const status=host.querySelector('[data-photo-notes-status]');
    if(status){
      status.textContent=draft.persistence==='session'?'Kept for this session only. This browser could not save your notes and PDF photo choices.':draft.persistence==='saved'?'Saved in this browser for this location.':'Notes and PDF photo choices save automatically in this browser for this location.';
      status.classList.toggle('photo-save-warning',draft.persistence==='session');
    }
  }
  function saveDraft(patch){draft=drafts.update(identity,patch);updateNotesState();}
  function updateOverview(){
    const preferred=draft.overviewPhotoIds[mode];
    if(preferred&&!included().some(photo=>photo.id===preferred))saveDraft({overviewPhotoIds:{[mode]:''}});
    const actual=overviewId();
    for(const photo of photos){
      const tile=host.querySelector(`[data-photo-id="${photo.id}"]`),radio=tile?.querySelector('[data-photo-overview]'),selection=tile?.querySelector('[data-photo-select]');
      const label=`${photo.category==='interior'?'interior':'exterior'} photo ${photos.indexOf(photo)+1}${photo.caption?': '+photo.caption:''}`;
      if(selection){
        selection.dataset.unavailable=String(!useOnlySelected());selection.disabled=busy||!useOnlySelected();
        selection.setAttribute('aria-label',`Include ${label} in PDF`);
      }
      if(radio){
        const excluded=useOnlySelected()&&photo.selected===false;
        radio.checked=photo.id===actual;radio.dataset.unavailable=String(excluded);radio.disabled=busy||excluded;
        radio.setAttribute('aria-label',`Use ${label} as overview photo`);
      }
      tile?.classList.toggle('photo-is-overview',photo.id===actual);
    }
    const automatic=host.querySelector('[data-photo-overview-auto]');
    if(automatic){automatic.dataset.unavailable=String(!draft.overviewPhotoIds[mode]);automatic.disabled=busy||!draft.overviewPhotoIds[mode];}
    const status=host.querySelector('[data-photo-overview-status]'),photo=photos.find(photo=>photo.id===actual);
    if(status)status.textContent=photo?`${draft.overviewPhotoIds[mode]?'Overview photo':'Automatic overview'}: ${photo.caption||`${photo.category==='interior'?'Interior':'Exterior'} photo ${photos.indexOf(photo)+1}`}.`:'Select Include in PDF for a photo to use an overview image.';
  }
  function updateCount(){
    const count=included().length,node=host.querySelector('[data-photo-count]');
    if(node)node.textContent=count?`${useOnlySelected()?`${count} of ${photos.length}`:`All ${photos.length} saved`} photo${photos.length===1?'':'s'} will appear in the PDF.`:`0 of ${photos.length} photos will appear in the PDF. Location details and notes only.`;
    updateOverview();
  }
  function choosePhotoSelection(onlySelected,token){
    if(!active(token))return;
    if(busy){host.querySelector('[data-photo-selected-only]').checked=draft.useOnlySelectedPhotos?.[mode]!==false;return;}
    clearPdf();saveDraft({useOnlySelectedPhotos:{[mode]:Boolean(onlySelected)}});updateCount();
    message('Photo choices changed. Create a new PDF to include these choices.');
  }
  function chooseOverview(id,token){
    if(!active(token))return;
    if(busy||(id&&!included().some(photo=>photo.id===id))){updateOverview();return;}
    clearPdf();saveDraft({overviewPhotoIds:{[mode]:id}});updateOverview();
    message(id?'Overview photo chosen. Create the PDF to see the new layout.':'The first included exterior photo will be used, or the first included photo if there is no exterior.');
  }
  function template(location,admin){return `
    <h3 class="section-title">Location photos &amp; PDF ${admin?'<span class="private-chip">Administrator only</span>':''}</h3>
    <p class="photo-location">${escape(location.name)}</p>
    <div class="photo-report-notes"><label for="locationPdfNotes">Notes for this PDF</label><p class="photo-help" id="photoReportNotesHelp">Enter one point per line. Notes appear beside the location photos; longer notes continue on another page. They also appear in the combined parking-lot PDF and PowerPoint.</p><textarea id="locationPdfNotes" data-photo-report-notes maxlength="${PDF_NOTES_LIMIT}" rows="5" aria-describedby="photoReportNotesHelp photoReportNotesSaveStatus" placeholder="Single hall shared by two congregations&#10;Loading area is beside the east entrance&#10;Keep the pedestrian path clear"></textarea><div class="photo-notes-meta"><span data-photo-notes-status id="photoReportNotesSaveStatus" role="status" aria-live="polite"></span><span data-photo-notes-count></span></div></div>
    ${admin?`<div class="photo-toolbar"><label>Photo library <select data-photo-library aria-label="Photo library"><option value="device" ${mode==='device'?'selected':''}>This device</option><option value="shared" ${mode==='shared'?'selected':''} ${createSharedStore?'':'disabled'}>Shared storage${createSharedStore?'':' — setup pending'}</option></select></label><button type="button" class="btn light" data-photo-refresh>Refresh photos</button></div>
    <p class="photo-help">${mode==='device'?'Saved in this browser on this device. Clearing site data removes these copies. Keep your originals; download a PDF for a portable copy.':'Private shared photos are available to the signed-in administrator on other devices.'}</p>
    ${!createSharedStore?'<p class="photo-pending">Shared storage is not enabled yet. Device saving and PDF downloads work now.</p>':''}
    <div class="photo-add"><label>Photo type <select data-photo-category aria-label="Photo type"><option value="interior">Interior</option><option value="exterior">Exterior</option></select></label><label class="photo-file-label">Add &amp; save photos <input data-photo-files type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add and save photos"></label></div>
    <p class="photo-help">Choose several JPG, PNG, or WebP files. Up to ${PHOTO_LIMIT} per location per library, 20 MB per original. Photos are resized and location metadata is removed.</p>
    <div class="photo-pdf-selection"><label class="photo-selection"><input type="checkbox" data-photo-selected-only ${draft.useOnlySelectedPhotos?.[mode]!==false?'checked':''} aria-describedby="photoSelectionHelp photoSelectionCount"> Use only selected photos</label><p class="photo-help" id="photoSelectionHelp">Check Include in PDF on the photos you want below. Uncheck this option to include every photo in this library; your individual checkmarks are kept for next time. This choice also applies to the combined PDF and PowerPoint.</p><p data-photo-count class="photo-count" id="photoSelectionCount" role="status" aria-live="polite"></p></div><p class="photo-help">Choose an included photo for the large overview image. Landscape exterior photos work well; the other included photos appear as supporting images. This choice is saved in this browser.</p><div class="photo-overview-toolbar"><p data-photo-overview-status class="photo-help"></p><button class="btn light" type="button" data-photo-overview-auto>Choose automatically</button></div><div data-photo-gallery></div>
    ${mode==='device'&&createSharedStore?'<button class="btn light" type="button" data-photo-copy>Copy selected photos to shared storage</button>':''}`:'<p class="photo-help">Sign in as the administrator to add, view, and select private location photos.</p>'}
    <div class="photo-export"><button type="button" class="btn blue" data-photo-pdf>Create location PDF</button><span class="photo-help">Landscape site visit overview with saved location details, your PDF notes${admin?', and the photos included above':''}. Includes the convention logo, sky header and hills footer. Private contacts and internal inspection notes are excluded.</span></div>
    ${admin&&openParkingPlanner?'<div class="photo-export"><button type="button" class="btn light" data-photo-parking>Combine with parking-lot plan</button><span class="photo-help">Open the parking-lot planner to choose a layout and create one PDF with this review, your PDF notes, and the photos included above.</span></div>':''}
    <div data-photo-pdf-links class="photo-pdf-links"></div><p data-photo-status role="status" aria-live="polite"></p>`;}
  async function showGallery(token){
    if(!active(token))return;
    urls.forEach(url=>w.URL.revokeObjectURL(url));urls=[];
    const gallery=host.querySelector('[data-photo-gallery]'); if(!gallery)return;
    gallery.innerHTML=['interior','exterior'].map(category=>`<h4>${category==='interior'?'Interior':'Exterior'}</h4><div class="photo-grid">${photos.filter(p=>p.category===category).map(p=>`<article class="photo-item" data-photo-id="${escape(p.id)}"><div class="photo-thumbnail" data-photo-thumbnail><span>Loading preview…</span></div><label class="photo-selection"><input type="checkbox" data-photo-select ${p.selected!==false?'checked':''}> Include in PDF</label><label class="photo-selection photo-overview-choice"><input type="radio" name="location-photo-overview" data-photo-overview> Use as overview photo</label><label>Caption <input type="text" maxlength="180" data-photo-caption value="${escape(p.caption)}" aria-label="${escape(category)} photo caption"></label><button type="button" class="btn light" data-photo-remove>Remove photo</button></article>`).join('')||'<p class="photo-help">No '+category+' photos saved.</p>'}</div>`).join('');
    updateCount();setBusy(busy);
    const locationId=currentLocation.id, readingStore=store;
    for(const photo of photos){
      const tile=gallery.querySelector(`[data-photo-id="${photo.id}"]`),box=tile.querySelector('[data-photo-thumbnail]');
      tile.querySelector('[data-photo-select]').addEventListener('change',event=>saveMetadata(photo,{selected:event.target.checked},token));
      tile.querySelector('[data-photo-overview]').addEventListener('change',event=>{if(event.target.checked)chooseOverview(photo.id,token);});
      const caption=tile.querySelector('[data-photo-caption]');
      caption.addEventListener('input',()=>{clearPdf();message('Caption edited. Choose Save caption to keep the change.');});
      const saveCaption=d.createElement('button');saveCaption.type='button';saveCaption.className='btn light';saveCaption.dataset.photoSaveCaption='';saveCaption.textContent='Save caption';saveCaption.disabled=busy;
      saveCaption.addEventListener('click',()=>saveMetadata(photo,{caption:caption.value},token));
      caption.parentElement.after(saveCaption);
      tile.querySelector('[data-photo-remove]').addEventListener('click',()=>remove(photo,token));
      try{
        const blob=await readingStore.thumbnail(locationId,photo);if(!active(token))return;
        const url=w.URL.createObjectURL(blob);urls.push(url);
        const img=d.createElement('img');img.src=url;img.alt=photo.caption||`${photo.category} photo`;box.replaceChildren(img);
      }catch(error){if(active(token))box.textContent='Preview unavailable. Refresh to retry.';}
    }
  }
  async function load(token){
    loaded=false;setBusy(true);message('Loading saved photos…');
    try{const records=await store.list(currentLocation.id);if(!active(token))return;photos=records;await showGallery(token);if(active(token)){loaded=true;message(photos.length?'Photos loaded.':'Add interior or exterior photos to this location.');}}
    catch(error){if(active(token))message('Could not load photos: '+photoError(error),true);}
    finally{if(active(token))setBusy(false);}
  }
  async function saveMetadata(photo,patch,token){
    if(busy||!active(token))return;setBusy(true);clearPdf();
    const next={...photo,...patch};
    try{await store.update(currentLocation.id,next);if(active(token)){Object.assign(photo,next);updateCount();message('Photo details saved.');}}
    catch(error){if(active(token)){const tile=host.querySelector(`[data-photo-id="${photo.id}"]`);tile.querySelector('[data-photo-select]').checked=photo.selected!==false;tile.querySelector('[data-photo-caption]').value=photo.caption;updateOverview();message('Could not save: '+photoError(error),true);}}
    finally{if(active(token))setBusy(false);}
  }
  async function add(files,category,token){
    if(busy||!active(token)||!files.length)return;clearPdf();
    if(files.length+photos.length>PHOTO_LIMIT){message(`Choose fewer files. This library has room for ${PHOTO_LIMIT-photos.length} more photos.`,true);return;}
    setBusy(true);const locationId=currentLocation.id,savingStore=store;let saved=0,failed=[];
    for(const file of files){
      if(!active(token))break;message(`Saving photo ${saved+failed.length+1} of ${files.length}…`);
      try{const photo=await prepare(file,category,{window:w,document:d});if(!active(token))break;await savingStore.add(locationId,photo);saved++;}
      catch(error){failed.push(`${file.name}: ${photoError(error)}`);}
    }
    if(active(token)){await load(token);message(`${saved} photo${saved===1?'':'s'} saved${mode==='device'?' on this device':' to shared storage'}.${failed.length?' '+failed.join(' '):''}`,failed.length>0);}
  }
  async function remove(photo,token){
    if(busy||!active(token)||!w.confirm(`Remove this ${photo.category} photo from the ${mode==='device'?'device':'shared'} library? Keep the original file if you may need it again.`))return;
    setBusy(true);clearPdf();
    try{const warning=await store.remove(currentLocation.id,photo.id);if(active(token)){await load(token);message(warning||'Photo removed.',Boolean(warning));}}
    catch(error){if(active(token))message('Could not remove photo: '+photoError(error),true);}
    finally{if(active(token))setBusy(false);}
  }
  async function copy(token){
    if(busy||!active(token))return;if(!selected().length){message('Select at least one photo to copy.',true);return;}
    setBusy(true);const locationId=currentLocation.id,shared=createSharedStore();let count=0;
    try{for(const photo of selected()){if(!active(token))return;message(`Copying photo ${count+1}…`);await shared.add(locationId,photo);count++;}if(active(token))message(`${count} photos copied. Choose Shared storage to view them. Device copies were kept.`);}
    catch(error){if(active(token))message(`${count} photos copied. ${photoError(error)}`,true);}
    finally{if(active(token))setBusy(false);}
  }
  function buildPdfSnapshot({expectedLocationId=currentLocation?.id}={}){
    const token=epoch,revision=pdfRevision;
    if(!currentLocation||!active(token)||String(currentLocation.id)!==String(expectedLocationId))throw Error('The selected location or sign-in changed. Choose the location and create the PDF again.');
    if(busy)throw Error('The photo library is still loading or saving. Wait for it to finish, then create the PDF again.');
    if(!loaded)throw Error('The photo library has not loaded. Close the parking-lot planner if needed, choose Refresh photos, and try again.');
    const unsaved=photos.some(photo=>host.querySelector(`[data-photo-id="${photo.id}"] [data-photo-caption]`)?.value!==photo.caption);
    if(unsaved)throw Error('Save the edited captions before creating the PDF.');
    const locationId=currentLocation.id,readingStore=store,report=currentReport(),reportKey=JSON.stringify(report),source=mode;
    const notes=reportNotes(currentNotes()),overviewPhotoId=overviewId(),onlySelected=useOnlySelected();
    // The renderer reads selected flags. Include every photo in all-photo mode
    // on export copies only, preserving the user's saved individual checkmarks.
    const snapshot=photos.map(photo=>({...photo,selected:!onlySelected||photo.selected!==false}));
    const isCurrent=()=>active(token)&&revision===pdfRevision&&String(getLocation()?.id)===String(locationId)&&JSON.stringify(currentReport())===reportKey&&currentNotes()===notes&&overviewId()===overviewPhotoId&&useOnlySelected()===onlySelected;
    const assertCurrent=()=>{if(!isCurrent())throw Error('The location, PDF notes, overview photo, selected photos, review details, or sign-in changed. Create the PDF again.');};
    return (async()=>{
      const result=await exportPdf({report,photos:snapshot,source,notes,overviewPhotoId,loadImage:async photo=>{assertCurrent();const blob=await readingStore.image(locationId,photo);assertCurrent();return blob;}});
      assertCurrent();if(!result?.blob?.size)throw Error('The location PDF was empty. Please try again.');
      return {...result,isCurrent};
    })();
  }
  async function pdf(token){
    if(busy||!active(token))return;
    clearPdf();message('Preparing a print-ready PDF…');
    try{
      const pending=buildPdfSnapshot({expectedLocationId:currentLocation.id});setBusy(true);
      const result=await pending;
      if(!active(token))return;if(!result.isCurrent())throw Error('The location, PDF notes, or selected photos changed. Create the PDF again.');pdfUrl=w.URL.createObjectURL(result.blob);
      const download=d.createElement('a');download.href=pdfUrl;download.download=result.filename;download.className='btn blue';download.textContent='Download PDF';
      const view=d.createElement('a');view.href=pdfUrl;view.target='_blank';view.rel='noopener';view.className='btn light';view.textContent='Open / print PDF';
      const checkCurrent=()=>{if(result.isCurrent())return true;clearPdf();message('The location, PDF notes, or selected photos changed. Create a new PDF.',true);return false;};
      for(const link of [download,view])link.addEventListener('click',event=>{if(!checkCurrent())event.preventDefault();});
      const presentation=d.createElement('button');presentation.type='button';presentation.className='btn light';presentation.textContent='Add to PowerPoint';
      presentation.addEventListener('click',async()=>{
        if(!checkCurrent())return;
        presentation.disabled=true;
        try{await sendToBuilder([{name:result.filename,blob:result.blob}],{window:w,isCurrent:result.isCurrent,notify:value=>{if(active(token))message(value);}});}
        catch(error){if(active(token))message('Could not add the PDF to PowerPoint: '+photoError(error),true);}
        finally{if(active(token)&&presentation.isConnected)presentation.disabled=false;}
      });
      host.querySelector('[data-photo-pdf-links]').append(download,view,presentation);message(`${result.pages} page PDF ready. Download it, open it to print, or add it to PowerPoint.${result.textWarning?' Some text characters need review; see the PDF text notice.':''}`,Boolean(result.textWarning));
    }catch(error){if(active(token))message('PDF was not created: '+photoError(error),true);}
    finally{if(active(token))setBusy(false);}
  }
  function contextChanged(force=false){
    const location=getLocation(),admin=isAdmin(),owner=getOwner?.()||'';
    const next=location?photoReportScope({locationId:location.id,admin,owner}):'';
    const nextReport=location?JSON.stringify(publicPhotoReport(location,getSummary?.())):'';
    if(!force&&next===identity){currentLocation=location?{...location}:null;if(reportIdentity!==nextReport)clearPdf();reportIdentity=nextReport;return;}
    if(admin&&!currentAdmin)mode=createSharedStore?'shared':'device';
    identity=next;currentAdmin=admin;reportIdentity=nextReport;const token=++epoch;clearUrls();photos=[];store=null;busy=false;loaded=!admin;currentLocation=location?{...location}:null;
    if(!location){host.hidden=true;host.replaceChildren();return;}host.hidden=false;
    draft=drafts.load(identity);
    if(!admin)mode='device';host.innerHTML=template(location,admin);
    const notes=host.querySelector('[data-photo-report-notes]');notes.value=draft.notes;updateNotesState();
    notes.addEventListener('input',()=>{
      if(!active(token))return;
      const hadPdf=Boolean(pdfUrl);
      clearPdf();
      try{saveDraft({notes:reportNotes(currentNotes())});if(hadPdf)message('PDF notes changed. Create a new PDF to include these notes.');}
      catch(error){updateNotesState();message(photoError(error),true);}
    });
    host.querySelector('[data-photo-pdf]').addEventListener('click',()=>pdf(token));
    host.querySelector('[data-photo-parking]')?.addEventListener('click',()=>{if(active(token)&&isAdmin())openParkingPlanner();});
    if(!admin)return;
    store=mode==='shared'?createSharedStore():createDeviceStore({indexedDB:w.indexedDB,owner});
    host.querySelector('[data-photo-refresh]').addEventListener('click',()=>contextChanged(true));
    host.querySelector('[data-photo-library]').addEventListener('change',event=>{mode=event.target.value;contextChanged(true);});
    host.querySelector('[data-photo-files]').addEventListener('change',event=>{const files=Array.from(event.target.files);event.target.value='';add(files,host.querySelector('[data-photo-category]').value,token);});
    host.querySelector('[data-photo-overview-auto]').addEventListener('click',()=>chooseOverview('',token));
    host.querySelector('[data-photo-selected-only]').addEventListener('change',event=>choosePhotoSelection(event.target.checked,token));
    host.querySelector('[data-photo-copy]')?.addEventListener('click',()=>copy(token));
    load(token);
  }
  return {contextChanged,buildPdfSnapshot,dispose(){epoch++;clearUrls();drafts.dispose?.();host.remove();style.remove();}};
}
