import {MAX_LAYOUTS, validatePlan} from './traffic-model.mjs?v=parking-dots-20261108-1';
import {exportTrafficPdf} from './traffic-pdf.mjs?v=parking-map-only-20261108-1';
import {PDF_LIMITS, exportFilename, validateSources, mergePdfDocuments as mergePdfs} from '../pdf-tools/pdf-merge.mjs?v=packets-20261107-1';
import {createPdfPresentation} from '../pdf-tools/presentation.mjs?v=packets-20261107-1';
import {awaitWithAbort, throwIfAborted} from '../pdf-tools/libraries.mjs?v=packets-20261107-1';

const DEFAULT_TITLE='Denver 2027 Location Photos and Parking';
const CHANGED='The selected locations, photo choices, saved details, or sign-in changed. Create the presentation again.';
const errorText=error=>String(error?.message||error||'The location could not be prepared.');
const locationName=location=>String(location?.name||`Location ${location?.markerLabel||location?.id||''}`).trim();

function checkedLibrary(library) {
  if(library!=='device'&&library!=='shared')throw Error('Choose the device or shared photo library.');
  return library;
}
function checkedLocation(location) {
  if(!location||typeof location!=='object'||location.id===undefined||location.id===null||!String(location.id).trim())throw Error('A selected location is unavailable. Refresh the location list.');
  return {...location,id:String(location.id)};
}
function checkedLayouts(records,locationId) {
  if(!Array.isArray(records)||records.length>MAX_LAYOUTS)throw Error('The saved parking layouts could not be read. Refresh the location list.');
  const ids=new Set();
  return records.map(record=>{
    const id=record?.id,savedAt=Number(record?.savedAt);
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||ids.has(id)||record.savedAt===null||record.savedAt===''||typeof record.savedAt==='boolean'||!Number.isFinite(savedAt))throw Error('The saved parking library has an invalid entry.');
    ids.add(id);
    return {id,savedAt,plan:validatePlan(record.plan,locationId)};
  });
}
function photoMetadata(value) {
  if(!value||typeof value!=='object'||value.error)throw Error(value?.error||'The location photo details could not be read.');
  const {photoCount,totalPhotos,hasNotes}=value;
  if(!Number.isInteger(photoCount)||photoCount<0||!Number.isInteger(totalPhotos)||totalPhotos<photoCount||typeof hasNotes!=='boolean')throw Error('The location photo details are incomplete. Refresh the location list.');
  if(typeof value.isCurrent==='function'&&!value.isCurrent())throw Error('The photo choices changed. Refresh the location list.');
  // Preview rows contain metadata only, never image Blobs, photo records, or
  // callbacks that could keep an image library alive after inspection.
  return Object.fromEntries(Object.entries(value).filter(([,item])=>item===null||['string','number','boolean'].includes(typeof item)));
}
function context({signal,isCurrent=()=>true,progress=()=>{}}) {
  const snapshots=[];
  let stopped=false;
  const current=()=>{
    if(stopped||signal?.aborted)return false;
    try{return Boolean(isCurrent())&&snapshots.every(check=>check());}catch{return false;}
  };
  const assert=()=>{throwIfAborted(signal);if(!current())throw Error(CHANGED);};
  const report=message=>{assert();progress(String(message));assert();};
  const wait=async start=>{assert();const value=await awaitWithAbort(start(),signal);assert();return value;};
  return {current,assert,report,wait,addSnapshot:check=>{if(typeof check==='function')snapshots.push(check);assert();},stop:()=>{stopped=true;}};
}

/** Inspect at most two locations at once. Failed reads remain visible as errors. */
export async function inspectPresentationLocations(locations,{
  library='device',inspectPhoto,listLayouts,progress=()=>{},signal,isCurrent=()=>true
}={}) {
  checkedLibrary(library);
  if(!Array.isArray(locations))throw Error('The location list is unavailable. Refresh the page.');
  if(typeof inspectPhoto!=='function'||typeof listLayouts!=='function')throw Error('Location photos and parking layouts are not ready. Refresh the page.');
  const scope=context({signal,isCurrent,progress}),rows=new Array(locations.length);
  let cursor=0,completed=0;
  scope.assert();
  async function worker() {
    while(cursor<locations.length) {
      scope.assert();
      const index=cursor++,original=locations[index];
      let location=original;
      try {
        location=checkedLocation(original);
        scope.report(`Checking location ${index+1} of ${locations.length}: ${locationName(location)}…`);
        const metadata=photoMetadata(await scope.wait(()=>inspectPhoto(location.id,{library,signal,isCurrent})));
        const layouts=checkedLayouts(await scope.wait(()=>listLayouts(location.id)),location.id);
        rows[index]={location,photos:metadata,layouts};
      }catch(error) {
        if(error?.name==='AbortError')throw error;
        scope.assert();
        rows[index]={location,photos:null,layouts:[],error:errorText(error)};
      }
      completed++;scope.report(`Checked ${completed} of ${locations.length} locations.`);
    }
  }
  try {
    await Promise.all(Array.from({length:Math.min(2,locations.length)},worker));
    scope.assert();return rows;
  }finally {scope.stop();}
}

function checkedSelections(selections) {
  if(!Array.isArray(selections)||!selections.length)throw Error('Select at least one location for the presentation.');
  if(selections.length>PDF_LIMITS.maxFiles)throw Error('Choose 50 locations or fewer for one presentation.');
  const ids=new Set();
  return selections.map(selection=>{
    const location=checkedLocation(selection?.location);
    if(ids.has(location.id))throw Error(`“${locationName(location)}” is selected more than once.`);
    ids.add(location.id);
    if(typeof selection.includePhotos!=='boolean')throw Error(`Choose whether to include the location report for “${locationName(location)}”.`);
    const layoutId=selection.layoutId??'';
    if(typeof layoutId!=='string'||(layoutId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(layoutId)))throw Error(`Choose a saved parking layout for “${locationName(location)}”.`);
    if(!selection.includePhotos&&!layoutId)throw Error(`Choose the location report or a saved parking layout for “${locationName(location)}”.`);
    return {location,includePhotos:selection.includePhotos,layoutId};
  });
}
function checkedPdf(result,fallbackName) {
  const [document]=validateSources([{name:result?.filename||fallbackName,blob:result?.blob}]);
  if(!Number.isInteger(result.pages)||result.pages<1)throw Error(`“${document.name}” did not contain a complete page count.`);
  if(result.pages>PDF_LIMITS.maxPages)throw Error('The selected reports contain more than 200 pages. Choose fewer photos or locations.');
  return {...document,pages:result.pages,textWarning:Boolean(result.textWarning)};
}

/** Build one ordered packet per location, then download-ready PowerPoint bytes.
 * Source adapters only read by location ID; this function never changes the UI,
 * photo selections, drafts, saved layouts, or database records.
 */
export async function buildLocationsPresentation(selections,{
  library='device',buildPhoto,listLayouts,exportParking=exportTrafficPdf,
  merge=mergePdfs,createPresentation=createPdfPresentation,
  progress=()=>{},signal,isCurrent=()=>true,document,window,
  title=DEFAULT_TITLE,filename,layout='wide',...engineOptions
}={}) {
  checkedLibrary(library);
  const selected=checkedSelections(selections),scope=context({signal,isCurrent,progress});
  scope.assert();
  if(selected.some(item=>item.includePhotos)&&typeof buildPhoto!=='function')throw Error('Location photos are not ready. Refresh the page.');
  if(selected.some(item=>item.layoutId)&&typeof listLayouts!=='function')throw Error('Saved parking layouts are not ready. Refresh the page.');
  const packets=[],warnings=[];
  const exportTitle=String(title||DEFAULT_TITLE).trim()||DEFAULT_TITLE;
  let pageCount=0;
  try {
    for(const [index,selection]of selected.entries()) {
      const {location,includePhotos,layoutId}=selection,label=locationName(location),parts=[];
      let savedPlan,textWarning=false;
      const report=message=>scope.report(`Location ${index+1} of ${selected.length} — ${label}: ${message}`);
      try {
        report('Preparing the selected reports…');
        if(layoutId) {
          report('Reading the saved parking layout…');
          const records=checkedLayouts(await scope.wait(()=>listLayouts(location.id)),location.id);
          const record=records.find(item=>item.id===layoutId);
          if(!record)throw Error('The selected saved parking layout no longer exists. Refresh the location list and choose a saved layout again.');
          // validatePlan returns a new plan and new geometry arrays.
          savedPlan=record.plan;
        }
        if(includePhotos) {
          report('Creating the location report and chosen photos…');
          // The source may compose this caller guard into its own snapshot
          // guard. Do not pass the composite scope back into itself.
          const photo=await scope.wait(()=>buildPhoto(location.id,{library,signal,progress:report,isCurrent}));
          scope.addSnapshot(photo?.isCurrent);
          const prepared=checkedPdf(photo,`${label}-location.pdf`);
          parts.push(prepared);textWarning||=prepared.textWarning;
        }
        if(savedPlan) {
          const parking=await scope.wait(()=>exportParking(savedPlan,{
            ...engineOptions,document,window,signal,unsaved:false,progress:report,isCurrent:scope.current
          }));
          const prepared=checkedPdf(parking,`${label}-parking.pdf`);
          parts.push(prepared);textWarning||=prepared.textWarning;
        }
        const pages=parts.reduce((sum,part)=>sum+part.pages,0);
        if(pageCount+pages>PDF_LIMITS.maxPages)throw Error('The selected reports contain more than 200 pages. Choose fewer photos or locations.');
        let packet=parts[0];
        if(parts.length===2) {
          report('Combining the location report and parking map…');
          const combined=await scope.wait(()=>merge(parts.map(({name,blob})=>({name,blob})),{
            ...engineOptions,document,window,signal,progress:report,isCurrent:scope.current,
            title:`${label} - Location photos and parking`,filename:exportFilename(`${label}-location-and-parking`,'pdf')
          }));
          packet=checkedPdf(combined,`${label}-location-and-parking.pdf`);
          if(packet.pages!==pages)throw Error('The location packet did not include every selected page. No incomplete presentation was created.');
        }
        packets.push({name:packet.name,blob:packet.blob});
        // One packet per location permits 50 locations even when every location
        // includes both a photo report and a parking PDF. Existing byte limits stay.
        validateSources(packets);pageCount+=packet.pages;
        if(textWarning)warnings.push(`${label}: Some text characters need review. See the text notice in this location’s slides.`);
        scope.assert();
      }catch(error) {
        if(error?.name==='AbortError')throw error;
        scope.assert();
        throw Error(`“${label}” could not be prepared: ${errorText(error)} No presentation was created.`);
      }
    }
    scope.report(`Creating one PowerPoint for ${selected.length} ${selected.length===1?'location':'locations'}…`);
    const result=await scope.wait(()=>createPresentation(packets.slice(),{
      ...engineOptions,document,window,signal,isCurrent:scope.current,progress:scope.report,
      title:exportTitle,filename:exportFilename(filename||exportTitle,'pptx'),layout
    }));
    if(!result?.blob?.size||typeof result.blob.arrayBuffer!=='function')throw Error('The PowerPoint download was empty. Create the presentation again.');
    if((result.slides??result.pages)!==pageCount)throw Error('The presentation did not include every selected page. No incomplete presentation was created.');
    scope.assert();
    return {...result,filename:exportFilename(result.filename||filename||exportTitle,'pptx'),locationCount:selected.length,warnings,isCurrent:scope.current};
  }catch(error) {
    scope.stop();throw error;
  }finally {packets.length=0;}
}
