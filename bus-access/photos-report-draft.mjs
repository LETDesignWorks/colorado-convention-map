export const PDF_NOTES_LIMIT = 6000;
const PREFIX = 'bus-access-pdf-report-v1:';
const blank = () => ({notes:'', overviewPhotoIds:{device:'', shared:''},useOnlySelectedPhotos:{device:true,shared:true}});

// A signed-in viewer has a separate draft from an anonymous viewer, even when
// neither can access administrator photos. JSON avoids ambiguous scope keys.
export function photoReportScope({locationId, owner='', admin=false}) {
  const account=String(owner||'');
  return JSON.stringify([String(locationId),admin?'admin':account?'viewer':'public',account]);
}

export function reportNotes(value='') {
  if(typeof value!=='string')throw Error('Enter the PDF notes as text.');
  const notes=value.replace(/\r\n?/g,'\n');
  if(notes.length>PDF_NOTES_LIMIT)throw Error(`Keep PDF notes to ${PDF_NOTES_LIMIT.toLocaleString('en-US')} characters or fewer.`);
  return notes;
}

export function pdfPhotos(photos, useOnlySelected=true) {
  return useOnlySelected===false?[...photos]:photos.filter(photo=>photo.selected!==false);
}

export function selectedOverviewPhotoId(photos, preferred='', useOnlySelected=true) {
  const included=pdfPhotos(photos,useOnlySelected);
  return (included.find(photo=>photo.id===preferred)||included.find(photo=>photo.category==='exterior')||included[0])?.id||'';
}

function photoId(value) {
  return typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value)?value:'';
}
function draftValue(value={}) {
  return {notes:reportNotes(value.notes??''),overviewPhotoIds:{
    device:photoId(value.overviewPhotoIds?.device),shared:photoId(value.overviewPhotoIds?.shared)
  },useOnlySelectedPhotos:{
    device:value.useOnlySelectedPhotos?.device!==false,shared:value.useOnlySelectedPhotos?.shared!==false
  }};
}
const copy = value => ({...value,overviewPhotoIds:{...value.overviewPhotoIds},useOnlySelectedPhotos:{...value.useOnlySelectedPhotos}});

// Only PDF-specific notes and photo preferences are stored here. No photo bytes,
// public review fields, private inspection notes, or cloud records are read or written.
// Memory keeps a draft usable while switching locations if browser saving fails.
export function createPhotoReportDraftStore({getStorage=()=>globalThis.localStorage}={}) {
  const memory=new Map();
  function load(scope) {
    if(memory.has(scope))return copy(memory.get(scope));
    let result={...blank(),persistence:'ready'};
    try {
      const storage=getStorage();
      if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('Browser saving unavailable.');
      const raw=storage.getItem(PREFIX+scope);
      if(raw!==null&&raw!==undefined) {
        const value=JSON.parse(raw);
        if(value?.version!==1)throw Error('Unknown PDF settings version.');
        result={...draftValue(value),persistence:'saved'};
      }
    } catch {result.persistence='session';}
    memory.set(scope,result);
    return copy(result);
  }
  function update(scope,patch) {
    const previous=load(scope);
    const next={...draftValue({...previous,...patch,
      overviewPhotoIds:{...previous.overviewPhotoIds,...patch.overviewPhotoIds},
      useOnlySelectedPhotos:{...previous.useOnlySelectedPhotos,...patch.useOnlySelectedPhotos}
    }),persistence:'session'};
    // Set memory first so quota errors or unavailable localStorage never lose the
    // text that the user just entered. Saving is retried on the next edit.
    memory.set(scope,next);
    try {
      const storage=getStorage();
      if(!storage||typeof storage.setItem!=='function')throw Error('Browser saving unavailable.');
      storage.setItem(PREFIX+scope,JSON.stringify({version:1,...draftValue(next)}));
      next.persistence='saved';
    } catch {}
    return copy(next);
  }
  return {load,update,dispose(){memory.clear();}};
}
