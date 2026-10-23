import {validatePlan, arrowheads} from './traffic-model.mjs?v=traffic-20261023-48';

// A detached, full-layout print snapshot. This module never writes to cloud storage.
export const PDF_LOGO_URL = new URL('../assets/denver-2027-territory-logo.png', import.meta.url).href;
const LIB_URL = new URL('../load-tests/vendor/pdf-lib.min.js', import.meta.url).href;
const ROUTES = {bus:{label:'Bus',color:[.145,.808,1]},car:{label:'Car',color:[.871,.608,1]},walk:{label:'Pedestrian',color:[1,.929,.404]}};
const PINS = {entry:'Entrance',exit:'Exit',loading:'Bus loading','no-entry':'No entry',note:'Note'};
const WARNING = 'Planning sketch only - not an approved traffic-control plan or a bus turning-clearance simulation. Verify on site with the property and transportation teams. Keep pedestrian and emergency access clear.';
let libraryPromise;
export function loadPdfLibrary(d=globalThis.document,w=globalThis.window) {
  if(w.PDFLib?.PDFDocument)return Promise.resolve(w.PDFLib);
  if(libraryPromise)return libraryPromise;
  libraryPromise=new Promise((resolve,reject)=>{
    const script=d.createElement('script');script.src=LIB_URL;script.async=true;
    const finish=error=>{clearTimeout(timer);script.onload=script.onerror=null;if(error){script.remove();reject(error);}else resolve(w.PDFLib);};
    const timer=setTimeout(()=>finish(Error('The PDF library took too long to load. Please retry.')),15000);
    script.onload=()=>finish(w.PDFLib?.PDFDocument?null:Error('The PDF library could not start.'));
    script.onerror=()=>finish(Error('The PDF library could not load. Check your connection and retry.'));d.head.append(script);
  }).catch(error=>{libraryPromise=null;throw error;});
  return libraryPromise;
}
export function worldPoint(point) {
  const [lat,lng]=point,sin=Math.sin(Math.max(-85,Math.min(85,lat))*Math.PI/180);
  return {x:(lng+180)/360*256,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*256};
}
export function layoutViewport(plan,width=736,height=350) {
  const points=plan.items.flatMap(item=>item.kind==='route'?item.points:[item.point]).map(worldPoint);
  let center=worldPoint([plan.view.lat,plan.view.lng]),scale=2**Math.min(21,plan.view.zoom)/2.5;
  if(points.length){
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    center={x:(left+right)/2,y:(top+bottom)/2};
    if(right-left>1e-10||bottom-top>1e-10)scale=Math.min(2**22/2.5,(width-90)/Math.max(right-left,1e-10),(height-90)/Math.max(bottom-top,1e-10));
  }
  const zoom=Math.max(0,Math.min(19,Math.ceil(Math.log2(scale*2.5))));
  return {width,height,scale,zoom,left:center.x-width/(2*scale),top:center.y-height/(2*scale),center};
}
export function projectPoint(point,viewport) {
  const p=worldPoint(point);return {x:(p.x-viewport.left)*viewport.scale,y:(p.y-viewport.top)*viewport.scale};
}
export function tileJobs(viewport,base) {
  const n=2**viewport.zoom,span=256/n,jobs=[];
  const x0=Math.floor(viewport.left/span),x1=Math.floor((viewport.left+viewport.width/viewport.scale-1e-12)/span);
  const y0=Math.floor(viewport.top/span),y1=Math.floor((viewport.top+viewport.height/viewport.scale-1e-12)/span);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    if(y<0||y>=n)continue;
    const tx=((x%n)+n)%n;
    jobs.push({x:(x*span-viewport.left)*viewport.scale,y:(y*span-viewport.top)*viewport.scale,size:span*viewport.scale,
      url:base==='street'?`https://tile.openstreetmap.org/${viewport.zoom}/${tx}/${y}.png`:`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${viewport.zoom}/${y}/${tx}`});
  }
  if(jobs.length>90)throw Error('The map is too large to export in one page. Try a smaller parking-lot layout.');
  return jobs;
}
async function readBytes(url,fetcher=globalThis.fetch) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetcher(url,{signal:controller.signal,cache:'force-cache',mode:'cors'});if(!response.ok)throw Error(`Image request failed (${response.status}).`);return new Uint8Array(await response.arrayBuffer());}
  finally{clearTimeout(timer);}
}
async function imageFromBytes(bytes,w) {
  const blob=new Blob([bytes]);
  if(w.createImageBitmap)return w.createImageBitmap(blob);
  return new Promise((resolve,reject)=>{const image=new w.Image(),url=w.URL.createObjectURL(blob);let timer;
    const finish=error=>{clearTimeout(timer);image.onload=image.onerror=null;w.URL.revokeObjectURL(url);error?reject(error):resolve(image);};
    image.onload=()=>finish();image.onerror=()=>finish(Error('A map image could not be decoded.'));timer=setTimeout(()=>finish(Error('Map image decoding timed out.')),10000);image.src=url;});
}
export async function renderBasemap(viewport,base,{document:d=globalThis.document,window:w=globalThis.window,fetch:fetcher=globalThis.fetch,progress=()=>{}}={}) {
  const canvas=d.createElement('canvas'),density=2.5;canvas.width=Math.ceil(viewport.width*density);canvas.height=Math.ceil(viewport.height*density);
  const context=canvas.getContext('2d');if(!context)throw Error('This browser cannot prepare a map image.');context.scale(density,density);context.fillStyle='#fff';context.fillRect(0,0,viewport.width,viewport.height);
  const jobs=tileJobs(viewport,base);let cursor=0,completed=0,failures=0;
  async function run(){while(cursor<jobs.length){const job=jobs[cursor++];let image;
    try{image=await imageFromBytes(await readBytes(job.url,fetcher),w);context.drawImage(image,job.x,job.y,job.size,job.size);}catch{failures++;}finally{image?.close?.();completed++;progress(`Preparing map background (${completed}/${jobs.length})...`);}
  }}
  await Promise.all(Array.from({length:Math.min(8,jobs.length)},run));
  if(failures||!jobs.length)throw Error('Some map background tiles could not be loaded. No incomplete PDF was created. Retry, or switch Background to Street map and export again.');
  return canvas.toDataURL('image/jpeg',.93);
}
// Standard PDF fonts support Western European text. Keep punctuation printable,
// and explicitly report characters requiring replacement rather than corrupting a file.
export function printable(text,font) {
  const normalized=String(text??'').replace(/[\r\t]/g,' ').replace(/[‐‑‒–—]/g,'-').replace(/…/g,'...').replace(/\u00a0/g,' ');
  return [...normalized].map(ch=>{if(ch==='\n')return ch;try{font.encodeText(ch);return ch;}catch{return '?';}}).join('');
}
export function wrapText(text,font,size,width) {
  const lines=[];
  for(const paragraph of printable(text,font).split('\n')){
    if(!paragraph){lines.push('');continue;}let line='';
    for(const word of paragraph.split(/\s+/)){
      if(font.widthOfTextAtSize(line?`${line} ${word}`:word,size)<=width){line=line?`${line} ${word}`:word;continue;}
      if(line){lines.push(line);line='';}
      for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}
    }lines.push(line);
  }return lines;
}
function dateLabel(date){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}).format(date)+' MT';}
export async function buildTrafficPdf(source,{PDFLib,logoBytes,mapImage,progress=()=>{},now=new Date(),unsaved=false}={}) {
  const plan=validatePlan(source,source.locationId);
  if(!PDFLib?.PDFDocument)throw Error('The PDF library is not available.');
  if(!logoBytes?.length)throw Error('The convention logo could not load. No unbranded PDF was created. Please retry.');
  const {PDFDocument,StandardFonts,rgb}=PDFLib,doc=await PDFDocument.create();
  const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(logoBytes);
  const c=(a)=>rgb(...a),navy=rgb(.12,.23,.38),ink=rgb(.13,.18,.24),muted=rgb(.36,.41,.47),white=rgb(1,1,1),orange=rgb(.98,.47,.10);
  doc.setTitle(`${plan.name} - Traffic patterns and cones`);doc.setSubject('2027 Denver Convention parking-lot planning sketch');doc.setCreator('Denver 2027 Bus Review');doc.setCreationDate(now);
  const text=(page,value,x,y,size=10,weight=font,color=ink)=>page.drawText(printable(value,weight),{x,y,size,font:weight,color});
  const lines=(page,value,x,y,size,width,weight=font,color=ink)=>{for(const line of wrapText(value,weight,size,width)){if(line)text(page,line,x,y,size,weight,color);y-=size+3;}return y;};
  function header(page,section){
    const dims=logo.scale(Math.min(154/logo.width,62/logo.height));page.drawImage(logo,{x:24+(154-dims.width)/2,y:612-24-dims.height,width:dims.width,height:dims.height});
    text(page,section.toUpperCase(),196,586,9,bold,navy);
    let y=lines(page,plan.name,196,566,16,572,bold,navy);
    y=lines(page,`${plan.locationName} | ${plan.locationAddress}`,196,y-2,9,572,font,muted);
    const lower=Math.min(508,y-8);page.drawLine({start:{x:24,y:lower},end:{x:768,y:lower},thickness:.7,color:rgb(.75,.80,.85)});
    return lower-18;
  }
  let page=doc.addPage([792,612]),top=header(page,'Traffic patterns & cones');
  const counts={cones:plan.items.filter(i=>i.kind==='cone').length,routes:plan.items.filter(i=>i.kind==='route').length,labels:plan.items.filter(i=>i.kind==='pin').length};
  text(page,`${counts.cones} cones   |   ${counts.routes} routes   |   ${counts.labels} labels`,24,top,10,bold);
  const map={x:24,y:117,width:744,height:top-13-117},viewport=layoutViewport(plan,map.width,map.height);
  progress('Preparing the full parking-lot map...');
  const background=await mapImage(viewport,plan.view.base);
  if(!background)throw Error('The map background was not produced.');
  const image=await doc.embedJpg(background);page.drawImage(image,map);
  const pos=point=>{const p=projectPoint(point,viewport);return{x:map.x+p.x,y:map.y+map.height-p.y};};
  const line=(a,b,width,color,dash)=>page.drawLine({start:a,end:b,thickness:width,color,lineCap:1,...(dash?{dashArray:dash}:{})});
  const routes=plan.items.filter(i=>i.kind==='route'),pins=plan.items.filter(i=>i.kind==='pin');
  for(const item of routes){
    const pts=item.points.map(pos),color=c(ROUTES[item.routeType].color);
    pts.slice(1).forEach((p,i)=>line(pts[i],p,5.8,navy));pts.slice(1).forEach((p,i)=>line(pts[i],p,3.4,color,item.routeType==='walk'?[7,4]:null));
    for(const a of arrowheads(pts)){
      const angle=a.angle*Math.PI/180,u={x:Math.cos(angle),y:Math.sin(angle)},n={x:-u.y,y:u.x},tip={x:a.x+5*u.x,y:a.y+5*u.y};
      const left={x:a.x-4*u.x+4*n.x,y:a.y-4*u.y+4*n.y},right={x:a.x-4*u.x-4*n.x,y:a.y-4*u.y-4*n.y};
      line(left,tip,5.5,navy);line(right,tip,5.5,navy);line(left,tip,2.6,color);line(right,tip,2.6,color);
    }
  }
  function cone(x,y,size=1){
    page.drawSvgPath('M -3 -6 L 3 -6 L 6 5 L -6 5 Z',{x,y,scale:size,color:orange,borderColor:navy,borderWidth:.5});
    page.drawRectangle({x:x-3.3*size,y:y-.8*size,width:6.6*size,height:2.2*size,color:white});
    page.drawRectangle({x:x-7*size,y:y-7*size,width:14*size,height:2*size,color:orange,borderColor:navy,borderWidth:.4});
  }
  plan.items.filter(i=>i.kind==='cone').forEach(item=>{const p=pos(item.point);cone(p.x,p.y,.8);});
  // Short numbered tags keep long custom descriptions off the map. Full text is
  // always printed in the accompanying item key, never truncated or discarded.
  const placed=[];
  function tag(point,value,color=navy){
    const p=pos(point),width=bold.widthOfTextAtSize(value,8)+10,height=15;
    const candidates=[[8,7],[8,-22],[-width-8,7],[-width-8,-22],[8,24],[8,-39]];
    let chosen;
    for(const[dx,dy]of candidates){const box={x:Math.max(map.x+2,Math.min(map.x+map.width-width-2,p.x+dx)),y:Math.max(map.y+2,Math.min(map.y+map.height-height-2,p.y+dy)),width,height};
      if(!placed.some(b=>box.x<b.x+b.width+2&&box.x+width+2>b.x&&box.y<b.y+b.height+2&&box.y+height+2>b.y)){chosen=box;break;}chosen??=box;}
    placed.push(chosen);line(p,{x:chosen.x+width/2,y:chosen.y+height/2},.6,white);
    page.drawRectangle({...chosen,color:white,borderColor:color,borderWidth:.8});text(page,value,chosen.x+5,chosen.y+4,8,bold,color);
    page.drawCircle({x:p.x,y:p.y,size:2.2,color,borderColor:white,borderWidth:.7});
  }
  routes.forEach((item,i)=>tag(item.points[0],`R${i+1}`));pins.forEach((item,i)=>tag(item.point,`L${i+1} ${PINS[item.pinType]}`,item.pinType==='no-entry'?rgb(.7,.13,.14):navy));
  page.drawRectangle({x:map.x+map.width-31,y:map.y+map.height-45,width:25,height:39,color:white,opacity:.92});
  text(page,'N',map.x+map.width-22,map.y+map.height-20,9,bold,navy);
  const nx=map.x+map.width-18,ny=map.y+map.height-27;line({x:nx,y:ny-11},{x:nx,y:ny},1.2,navy);line({x:nx-3,y:ny-4},{x:nx,y:ny},1.2,navy);line({x:nx+3,y:ny-4},{x:nx,y:ny},1.2,navy);
  let lx=32;cone(lx,97,.7);text(page,'Cone',lx+12,94,9);lx=113;
  for(const type of ['bus','car','walk']){line({x:lx,y:97},{x:lx+24,y:97},5,navy);line({x:lx,y:97},{x:lx+24,y:97},2.8,c(ROUTES[type].color),type==='walk'?[6,3]:null);text(page,ROUTES[type].label,lx+31,94,9);lx+=type==='walk'?135:95;}
  text(page,'R = route key     L = location label key',477,94,9);
  const attribution=plan.view.base==='street'?'Map: © OpenStreetMap contributors':'Imagery: © Esri, Maxar, Earthstar Geographics and GIS User Community';
  text(page,attribution,24,77,7,font,muted);text(page,'Full layout fitted to page. Notes and item key follow.',24,64,8,font,muted);
  if(!plan.items.length)text(page,'No traffic items in this layout.',map.x+20,map.y+20,11,bold,navy);
  // Notes/key pages paginate by measured text width and available height.
  let y=0;
  function detailsPage(){page=doc.addPage([792,612]);y=header(page,'Setup notes & item key');}
  function paragraph(value,size=10,weight=font,color=ink){for(const entry of wrapText(value,weight,size,744)){
    if(y<size+55)detailsPage();if(entry)text(page,entry,24,y,size,weight,color);y-=size+4;}y-=7;}
  detailsPage();paragraph(plan.locationName,14,bold,navy);paragraph(plan.locationAddress,10);
  paragraph(unsaved?'CURRENT DRAFT EXPORT - not saved to the cloud by exporting.':'Exported layout snapshot. Exporting does not create or update a saved layout.',9,bold,navy);
  paragraph(`Prepared ${dateLabel(now)}. ${counts.cones} cones; ${counts.routes} routes; ${counts.labels} location labels.`,9);
  paragraph('Setup notes',12,bold,navy);paragraph(plan.notes||'No setup notes entered.');
  if(routes.length){paragraph('Route key',12,bold,navy);routes.forEach((item,i)=>paragraph(`R${i+1} - ${ROUTES[item.routeType].label}: ${item.label||'Unnamed route'}`,10));}
  if(pins.length){paragraph('Location label key',12,bold,navy);pins.forEach((item,i)=>paragraph(`L${i+1} - ${PINS[item.pinType]}: ${item.label||PINS[item.pinType]}`,10));}
  paragraph('Before use',12,bold,navy);paragraph(WARNING,9);paragraph('Aerial imagery may be outdated. Enlarging imagery does not add detail. Cone quantities and spacing are user-defined, not calculated safety recommendations. Map orientation is north-up; the printed layout is not to a fixed scale.',9);
  const allText=[plan.name,plan.locationName,plan.locationAddress,plan.notes,...plan.items.map(i=>i.label)].join('\n');
  const unsupported=[...new Set([...allText].filter(ch=>{if(/[\n\r\t‐‑‒–—…\u00a0]/.test(ch))return false;try{font.encodeText(ch);return false;}catch{return true;}}))];
  if(unsupported.length)paragraph('Text notice: Some non-Western characters were replaced with ? for this PDF. The original layout and JSON retain the complete text.',9,bold);
  for(const[p,index]of doc.getPages().map((p,i)=>[p,i])){
    p.drawLine({start:{x:24,y:42},end:{x:768,y:42},thickness:.6,color:rgb(.8,.83,.87)});
    text(p,'PLANNING SKETCH - VERIFY ON SITE',24,28,8,bold,navy);text(p,dateLabel(now),340,28,8,font,muted);text(p,`${index+1} / ${doc.getPageCount()}`,727,28,8,font,muted);
  }
  progress('Finishing the branded PDF...');const bytes=await doc.save();
  const stem=plan.name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,110)||'traffic-layout';
  return{blob:new Blob([bytes],{type:'application/pdf'}),filename:`${stem}-traffic-plan.pdf`,pages:doc.getPageCount(),textWarning:unsupported.length>0};
}
export async function exportTrafficPdf(source,options={}) {
  const plan=validatePlan(source,source.locationId);
  const d=options.document||globalThis.document,w=options.window||globalThis.window;
  const progress=options.progress||(()=>{});progress('Loading convention logo and PDF tools...');
  const [PDFLib,logoBytes]=await Promise.all([loadPdfLibrary(d,w),readBytes(PDF_LOGO_URL,options.fetch||globalThis.fetch)]);
  return buildTrafficPdf(plan,{...options,PDFLib,logoBytes,mapImage:(viewport,base)=>renderBasemap(viewport,base,{...options,document:d,window:w})});
}
