import {buildPhotoPdf, publicPhotoReport} from './photos-pdf.mjs?v=parking-map-only-20261108-1';
import {photoReportScope, reportNotes, pdfPhotos, selectedOverviewPhotoId} from './photos-report-draft.mjs?v=photo-selection-20261107-1';
import {throwIfAborted, awaitWithAbort} from '../pdf-tools/libraries.mjs?v=packets-20261107-1';

const changedMessage='The location, photo captions, PDF notes, photo choices, or sign-in changed. Create the presentation again.';
const draftKey=(draft,library)=>JSON.stringify({notes:reportNotes(draft.notes??''),overviewPhotoId:draft.overviewPhotoIds?.[library]||'',useOnlySelected:draft.useOnlySelectedPhotos?.[library]!==false});

// Read-only access to arbitrary locations. The panel supplies its exact draft
// store so browser-storage failures do not discard session-only PDF settings.
export function createPhotoPresentationProvider({
  getLocation, getLocationById, getSummary, getSummaryFor, getOwner, isAdmin,
  getLibrary, drafts, createSharedStore, createDeviceStore, indexedDB,
  readLiveState=()=>null, getPhotoRevision=()=>0, hasPendingPhotoWrite=()=>false,
  exportPdf=buildPhotoPdf
}) {
  let disposed=false;
  function reportFor(locationId){
    const location=getLocationById?getLocationById(locationId):getLocation?.();
    if(!location||String(location.id)!==locationId)throw Error('This meeting location is unavailable. Refresh the locations and try again.');
    let summary;
    if(getSummaryFor)summary=getSummaryFor(locationId);
    else{
      if(String(getLocation?.()?.id)!==locationId)throw Error('Open this location before creating its report, or refresh the presentation tools.');
      summary=getSummary?.();
    }
    return publicPhotoReport(location,summary||{});
  }
  async function capture(locationId,{library=getLibrary(),signal,operation}){
    throwIfAborted(signal);
    const owner=String(getOwner?.()||'');
    if(disposed||!isAdmin()||!owner)throw Error('Administrator sign-in is required to create a locations presentation.');
    if(library!=='device'&&library!=='shared')throw Error('Choose This device or Shared storage for the photos.');
    if(library==='shared'&&!createSharedStore)throw Error('Shared photo storage is unavailable. Choose This device or refresh and try again.');
    const id=String(locationId),scope=photoReportScope({locationId:id,owner,admin:true});
    if(hasPendingPhotoWrite(scope,library))throw Error('Photos for this location are still saving. Wait for them to finish, then retry.');
    const report=reportFor(id),reportKey=JSON.stringify(report),draft=drafts.load(scope),settingsKey=draftKey(draft,library);
    const live=readLiveState({locationId:id,library,scope,operation});
    const notes=reportNotes(live?.notes??draft.notes??''),useOnlySelected=live?.useOnlySelected??(draft.useOnlySelectedPhotos?.[library]!==false);
    const revision=getPhotoRevision(scope,library);
    const isCurrent=()=>{
      try{
        // Legacy mounts can export their current location. Once the user moves
        // away, those mounts have no getter for its report; navigation alone
        // does not invalidate the already captured public report.
        const reportUnchanged=(!getLocationById||!getSummaryFor)&&String(getLocation?.()?.id)!==id?true:JSON.stringify(reportFor(id))===reportKey;
        return !disposed&&!signal?.aborted&&isAdmin()&&String(getOwner?.()||'')===owner&&
          reportUnchanged&&draftKey(drafts.load(scope),library)===settingsKey&&
          getPhotoRevision(scope,library)===revision&&!hasPendingPhotoWrite(scope,library)&&(!live?.isCurrent||live.isCurrent());
      }catch{return false;}
    };
    const assertCurrent=()=>{throwIfAborted(signal);if(!isCurrent())throw Error(changedMessage);};
    assertCurrent();
    const store=library==='shared'?createSharedStore():createDeviceStore({indexedDB,owner});
    const records=await awaitWithAbort(store.list(id),signal);assertCurrent();
    if(!Array.isArray(records))throw Error('The photo library could not be read. Refresh it and try again.');
    // Selection changes apply only to export copies, never the saved library.
    const photos=records.map(photo=>({...photo,selected:!useOnlySelected||photo.selected!==false}));
    const overviewPhotoId=selectedOverviewPhotoId(photos,draft.overviewPhotoIds?.[library]||'',true);
    return {locationId:id,report,photos,source:library,notes,useOnlySelected,overviewPhotoId,store,isCurrent,assertCurrent};
  }
  return {
    getPresentationContext:()=>({library:getLibrary(),sharedAvailable:Boolean(createSharedStore)}),
    async inspectPresentationLocation(locationId,{library=getLibrary(),signal}={}){
      const snapshot=await capture(locationId,{library,signal,operation:'inspect'});
      snapshot.assertCurrent();
      // The catalog keeps scalar metadata only, not device image Blobs.
      return {photoCount:pdfPhotos(snapshot.photos).length,totalPhotos:snapshot.photos.length,hasNotes:Boolean(snapshot.notes.trim()),useOnlySelected:snapshot.useOnlySelected,overviewPhotoId:snapshot.overviewPhotoId};
    },
    async buildPresentationLocation(locationId,{library=getLibrary(),signal,progress=()=>{}}={}){
      const snapshot=await capture(locationId,{library,signal,operation:'build'});
      const {report,photos,source,notes,overviewPhotoId}=snapshot;
      progress(`Preparing location photos: ${report.name}`);snapshot.assertCurrent();
      let loaded=0;
      const result=await awaitWithAbort(exportPdf({report,photos,source,notes,overviewPhotoId,
        loadImage:async photo=>{
          snapshot.assertCurrent();
          const blob=await awaitWithAbort(snapshot.store.image(snapshot.locationId,photo),signal);snapshot.assertCurrent();
          progress(`Preparing ${report.name}: photo ${++loaded} of ${pdfPhotos(photos).length}`);
          return blob;
        }
      }),signal);
      snapshot.assertCurrent();
      if(!result?.blob?.size||typeof result.blob.arrayBuffer!=='function')throw Error('The location PDF was empty. Please try again.');
      return {...result,isCurrent:snapshot.isCurrent};
    },
    dispose(){disposed=true;}
  };
}
