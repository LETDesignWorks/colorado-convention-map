import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {getFirestore,collection,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {HALLS} from '../bus-access/data.js?v=foxfield-congregations-20261111-1';
import {rankedLocations,sameLocation,timeColor} from './model.mjs?v=rush-20261108-1';
import {makeReport,reportHtml} from './results-report.mjs?v=rush-pdf-20261109-1';
import {HOTELS} from '../routes/hotels.js';
import {initTripPlanner} from './trip-planner.mjs?v=separate-centers-20261111-1';
import {waitForPrintRibbons} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';

const ids=['destinationGroup','morning','afternoon','busAllowance','search','referenceTime','dataStatus','validation','listTitle','count','groupNote','rankingRows','routeDetails'];
const els=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urlParams=new URLSearchParams(location.search);
els.destinationGroup.value=urlParams.get('group')==='activities'?'activities':'meetings';
let period=urlParams.get('period')==='am'?'am':'pm',data,meetingLocations=[],rows=[],selectedId=urlParams.get('location'),shown=new Set(),layers=new Map(),markers=new Map();
const map=L.map('map').setView([39.76,-105.05],10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const busLabels={'45-foot-motorcoach':'45-foot motorcoach','40-foot-motorcoach':'40-foot motorcoach','school-bus':'School bus',shuttle:'Shuttle bus','passenger-van':'Passenger van'};
const displayLabel=row=>els.destinationGroup.value==='activities'?(row.activityLabel||row.label):row.label;
const displayedLocations=()=>els.destinationGroup.value==='activities'?data.locations.filter(l=>l.groups.includes('activities')):meetingLocations;
const pdfButton=document.getElementById('downloadResultsPdf'),printButton=document.getElementById('printResults'),exportStatus=document.getElementById('exportStatus');
let exportBusy=false,printSnapshot=null;
const tripPlanner=initTripPlanner({hotels:HOTELS});
function syncTripLocations(){tripPlanner.setLocations({meetings:meetingLocations,activities:data.locations.filter(l=>l.groups.includes('activities')),origin:data.origin,status:els.dataStatus.textContent});}
function setExportButtons(){const ready=!!data&&els.validation.hidden&&!!rows.length;pdfButton.disabled=!ready||exportBusy;printButton.disabled=!ready||exportBusy;document.getElementById('printRanking').disabled=!ready||exportBusy;}
function captureReport(){
  if(!data||!els.validation.hidden)throw Error('Load valid results before printing or downloading.');
  return makeReport({rows,group:els.destinationGroup.value,period,allowance:els.busAllowance.value,query:els.search.value,selectedId,origin:data.origin,reference:els.referenceTime.textContent,approvalStatus:els.dataStatus.textContent,checkedDate:data.checkedDate});
}
function preparePrint(report){document.getElementById('rushPrintReport').innerHTML=reportHtml(report);document.body.classList.add('rush-print');}
window.addEventListener('beforeprint',()=>{if(document.body.classList.contains('trip-print'))return;try{preparePrint(printSnapshot||captureReport());}catch(error){document.getElementById('rushPrintReport').textContent=error.message;document.body.classList.add('rush-print');}});
window.addEventListener('afterprint',()=>{document.body.classList.remove('rush-print');printSnapshot=null;});
async function printResults(){
  if(exportBusy)return;try{printSnapshot=captureReport();exportBusy=true;setExportButtons();exportStatus.textContent='Preparing the print layout…';await waitForPrintRibbons();preparePrint(printSnapshot);exportStatus.textContent='Choose Save as PDF in the print destination to save a PDF copy.';window.print();}
  catch(error){exportStatus.textContent=error.message;document.body.classList.remove('rush-print');}
  finally{printSnapshot=null;exportBusy=false;setExportButtons();}
}
async function downloadResultsPdf(){
  if(exportBusy)return;try{const report=captureReport();exportBusy=true;setExportButtons();pdfButton.textContent='Preparing PDF…';exportStatus.textContent='Preparing the ranked results and selected route details…';
    const {exportResultsPdf}=await import('./results-pdf.mjs?v=rush-pdf-20261109-1');const result=await exportResultsPdf(report);
    const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=result.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    exportStatus.textContent=`PDF ready (${result.pages} ${result.pages===1?'page':'pages'}). Check your downloads; on mobile use Share to save or print.`;
  }catch(error){exportStatus.textContent='Could not create the PDF: '+error.message+' You can also use Print / Save PDF.';}
  finally{exportBusy=false;pdfButton.textContent='Download PDF';setExportButtons();}
}
pdfButton.addEventListener('click',downloadResultsPdf);printButton.addEventListener('click',printResults);document.getElementById('printRanking').addEventListener('click',printResults);

function syncUrl(){const url=new URL(location.href);url.searchParams.set('group',els.destinationGroup.value);url.searchParams.set('period',period);if(selectedId)url.searchParams.set('location',selectedId);else url.searchParams.delete('location');history.replaceState(null,'',url);}
function rangeLabel(forecast){return forecast?forecast.routes[0].rangeText:'Needs traffic check';}
function drawMap(){
  for(const layer of layers.values())map.removeLayer(layer);layers.clear();
  for(const marker of markers.values())map.removeLayer(marker);markers.clear();
  for(const row of rows){
    const color=timeColor(row.planningMinutes);
    const marker=L.marker([row.lat,row.lng],{icon:L.divIcon({className:'',html:'<div class="rank-marker" style="background:'+color+'"><span class="sr-only">Travel rank </span><span>'+(row.rank??'?')+'</span></div>',iconSize:[31,31],iconAnchor:[15,15]})}).addTo(map);
    marker.bindTooltip(escape((row.rank?'#'+row.rank+' · ':'')+row.name),{direction:'top'}).on('click',()=>selectLocation(row.id,true));markers.set(row.id,marker);
    if(shown.has(row.id)&&row.roadRoute?.geometry){
      const line=L.geoJSON(row.roadRoute.geometry,{style:{color,weight:selectedId===row.id?7:4,opacity:selectedId===row.id?0.95:0.55}}).addTo(map);
      line.bindTooltip(escape(row.name+' · '+(row.planningMinutes===null?'Needs traffic check':row.planningMinutes+' min plan'))).on('click',()=>selectLocation(row.id,false));layers.set(row.id,line);
    }
  }
  layers.get(selectedId)?.bringToFront();
}
function fitMap(){
  const points=[[data.origin.lat,data.origin.lng],...rows.filter(row=>shown.has(row.id)).map(row=>[row.lat,row.lng])];
  if(points.length===1)points.push(...rows.map(row=>[row.lat,row.lng]));
  map.fitBounds(points,{padding:[30,30],maxZoom:13});
}
function render(){
  const allowance=Number(els.busAllowance.value);
  try{if(els.busAllowance.value.trim()==='')throw Error('Enter a bus allowance from 0 to 90 minutes.');rows=rankedLocations(displayedLocations(),period,allowance);els.validation.hidden=true;}catch(error){els.validation.textContent=error.message;els.validation.hidden=false;setExportButtons();return;}
  els.morning.setAttribute('aria-pressed',String(period==='am'));els.afternoon.setAttribute('aria-pressed',String(period==='pm'));
  els.referenceTime.textContent='Reference: Tuesday, Nov 10, 2026 · '+(period==='am'?'8:00 AM':'5:00 PM')+' MST · bus allowance '+allowance+' min';
  const activities=els.destinationGroup.value==='activities';
  els.listTitle.textContent=activities?'Activity destinations':'Approved meeting locations';
  els.groupNote.textContent=activities?'Includes venue, drop-off and pickup points from Activities and Activity Planning. Every trip here starts at the convention center; a pickup-point route is not a return trip.':'Only locations currently marked Approved are ranked. Review the largest bus approved at each property before assigning a coach.';
  const rankedCount=rows.filter(r=>r.forecast).length;
  els.count.textContent=rankedCount+' ranked'+(rankedCount<rows.length?' · '+(rows.length-rankedCount)+' need checks':'');
  const query=els.search.value.trim().toLowerCase();const filtered=rows.filter(row=>(row.name+' '+row.address+' '+displayLabel(row)).toLowerCase().includes(query));
  els.rankingRows.innerHTML=filtered.length?filtered.map(row=>'<tr class="'+(row.id===selectedId?'row-selected':'')+'"><td><button class="location-button" type="button" data-select="'+escape(row.id)+'"><span class="rank" style="--rank-color:'+timeColor(row.planningMinutes)+'">'+(row.rank??'?')+'</span><span>'+escape(displayLabel(row)+' · '+row.name)+'</span></button><small class="location-address">'+escape(row.address)+'</small></td><td>'+escape(rangeLabel(row.forecast))+'</td><td style="color:'+timeColor(row.planningMinutes)+'">'+(row.planningMinutes===null?'—':row.planningMinutes+' min')+'</td><td><input type="checkbox" data-map="'+escape(row.id)+'" aria-label="Show route to '+escape(row.name)+'" '+(shown.has(row.id)?'checked':'')+(row.roadRoute?'':' disabled')+'></td></tr>').join(''):'<tr><td colspan="4">No matching destinations.</td></tr>';
  els.rankingRows.querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>selectLocation(button.dataset.select,true)));
  els.rankingRows.querySelectorAll('[data-map]').forEach(input=>input.addEventListener('change',()=>{input.checked?shown.add(input.dataset.map):shown.delete(input.dataset.map);drawMap();}));
  drawMap();renderDetail();syncUrl();setExportButtons();
}
function selectLocation(id,fit){selectedId=id;shown.add(id);render();if(fit){const line=layers.get(id);if(line)map.fitBounds(line.getBounds(),{padding:[35,35],maxZoom:14});else{const row=rows.find(r=>r.id===id);if(row)map.setView([row.lat,row.lng],13);}}}
function renderDetail(){
  const row=rows.find(r=>r.id===selectedId);
  if(!row){els.routeDetails.innerHTML='<h2>Select a location</h2><p>Choose a name in the ranking to see its traffic forecasts and directions.</p>';return;}
  const forecast=row.forecast,primary=forecast?.routes[0];
  let html='<span class="route-number">'+(row.rank?'Rank '+row.rank:'Traffic check needed')+' · '+escape(displayLabel(row))+'</span><h2>'+escape(row.name)+'</h2><p>'+escape(row.address)+'</p>';
  if(primary){
    html+='<div class="detail-times"><div><strong>'+escape(primary.rangeText)+'</strong><small>Google predicted car travel</small></div><div><strong>'+row.planningMinutes+' min</strong><small>Upper forecast + '+escape(els.busAllowance.value)+' min bus allowance</small></div></div><p><strong>Forecast route:</strong> '+escape(primary.via)+' · '+primary.miles+' miles<br><strong>Departure:</strong> Tue, Nov 10, 2026, '+(period==='am'?'8:00 AM':'5:00 PM')+' MST</p>';
    if(forecast.routes.length>1)html+='<p><strong>Other Google route choices</strong></p><ul>'+forecast.routes.slice(1).map(route=>'<li>'+escape(route.via)+' — '+escape(route.rangeText)+' · '+route.miles+' miles</li>').join('')+'</ul>';
    html+='<div class="detail-actions"><a class="btn" target="_blank" rel="noopener" href="'+escape(forecast.sourceUrl)+'">Open Google forecast / change date</a></div>';
  }else html+='<p>This location is newly approved or its address / pin changed. It needs a new traffic forecast before it can be ranked.</p>';
  if(els.destinationGroup.value==='meetings')html+='<p><strong>Largest bus reviewed:</strong> '+escape(busLabels[row.busSize]||row.busSize||'Not specified')+'</p><a href="../bus-access/#location-'+encodeURIComponent(row.id)+'">Open bus-access review</a>';
  if(row.note)html+='<p>'+escape(row.note)+'</p>';
  if(row.publicSummary)html+='<p>'+escape(row.publicSummary)+'</p>';
  html+='<p class="small">The bus allowance is editable, not a measured motorcoach delay. Confirm loading time, vehicle restrictions, any tolls and the actual departure-day traffic with the operator. Map lines may differ from the forecast route above.</p>';
  els.routeDetails.innerHTML=html;
}
function rebuildFromLive(snapshot){
  const publicRecords=new Map();snapshot.forEach(doc=>publicRecords.set(doc.id,doc.data()));
  const base=HALLS.map(h=>({...h,id:String(h.id),label:String(h.number)}));
  const custom=[...publicRecords].filter(([,d])=>d.customLocation===true).map(([id,d])=>({...d,id,label:d.markerLabel||d.number||'M',lat:Number(d.lat),lng:Number(d.lng)})).filter(d=>Number.isFinite(d.lat)&&Number.isFinite(d.lng));
  meetingLocations=[...base,...custom].filter(row=>publicRecords.get(row.id)?.busStatus==='approved').map(row=>{
    const snapshotLocation=data.locations.find(l=>l.id===row.id),details=publicRecords.get(row.id);
    return{...row,groups:['meetings'],busSize:details.busSize||'',publicSummary:details.publicSummary||'',...(snapshotLocation&&sameLocation(row,snapshotLocation)?{forecasts:snapshotLocation.forecasts,roadRoute:snapshotLocation.roadRoute}:{})};
  });
  els.dataStatus.textContent='Live bus-access approval status loaded. Traffic times remain the dated forecast snapshot.';
  render();syncTripLocations();
}

try{
  const response=await fetch('./data.json?v=rush-20261108-1');if(!response.ok)throw new Error('Route comparison data could not load.');data=await response.json();
  meetingLocations=data.locations.filter(l=>l.groups.includes('meetings'));
  L.marker([data.origin.lat,data.origin.lng],{icon:L.divIcon({className:'',html:'<div class="ccc-marker">★</div>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map).bindTooltip('Colorado Convention Center',{permanent:true,direction:'top'});
  shown=new Set(rankedLocations(displayedLocations(),period,15).slice(0,5).map(r=>r.id));if(selectedId)shown.add(selectedId);render();fitMap();
  els.dataStatus.textContent='Showing approval snapshot from Nov 8, 2026 while current approval status loads.';syncTripLocations();
  els.destinationGroup.addEventListener('change',()=>{selectedId=null;els.search.value='';shown=new Set(rankedLocations(displayedLocations(),period,Number(els.busAllowance.value)||0).slice(0,5).map(r=>r.id));render();fitMap();});
  for(const [element,value] of [[els.morning,'am'],[els.afternoon,'pm']])element.addEventListener('click',()=>{period=value;render();});
  els.busAllowance.addEventListener('input',render);els.search.addEventListener('input',render);
  document.getElementById('topFive').addEventListener('click',()=>{shown=new Set(rows.filter(r=>r.forecast).slice(0,5).map(r=>r.id));render();fitMap();});
  document.getElementById('showAll').addEventListener('click',()=>{shown=new Set(rows.filter(r=>r.roadRoute).map(r=>r.id));render();fitMap();});
  document.getElementById('clearRoutes').addEventListener('click',()=>{shown.clear();render();});
  document.getElementById('fitMap').addEventListener('click',fitMap);
  const config={apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',appId:'1:29365992209:web:0bd35e723688b37d776ab0'};
  const app=getApps().find(app=>app.options.projectId===config.projectId)||initializeApp(config,'rush-hour');
  onSnapshot(collection(getFirestore(app),'halls'),rebuildFromLive,()=>{els.dataStatus.textContent='Current approval status is unavailable. Showing the saved approval snapshot from Nov 8, 2026.';syncTripLocations();});
}catch(error){els.dataStatus.textContent=error.message;els.validation.hidden=false;els.validation.textContent='Reload the page to retry.';setExportButtons();}


