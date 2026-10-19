// Isolated browser QA: run `node tests/saved-territories-preview.mjs`, then open
// http://127.0.0.1:8786/territories/. No production Firebase access or writes.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { makePdfArchive } from '../territories/pdf-archive.js';
const root = resolve(import.meta.dirname, '..');
const polygon = x => ({ type: 'Polygon', coordinates: [[[x,39.74],[x+.008,39.74],[x+.008,39.748],[x,39.748],[x,39.74]]] });
const home = (id, x) => ({ id:id+'-home', territoryId:id, address:'100 Example Street', lat:39.743, lng:x+.003, included:true });
const records = [];
function plan(id, territoryId, x, time, hallId='1') {
  records.push({id, recordType:'territory-plan', hallId, congregation:'QA congregation', planName:id, updatedAt:time,
    territoriesJson:JSON.stringify([{id:territoryId, name:'QA-01', geometry:polygon(x), houseIds:[territoryId+'-home']}]), chunkIds:[id+'-chunk'], houseCount:1});
  records.push({id:id+'-chunk',recordType:'territory-plan-chunk',planId:id,chunkIndex:0,houses:[home(territoryId,x)]});
}
plan('Plan saved in 2021','territory-one',-105.04,'2021-01-01');
plan('Latest saved plan','territory-one',-105.03,'2026-10-19');
plan('Separate territory with the same name','territory-two',-105.01,'2025-01-01');
plan('Other meeting place','territory-other',-104.98,'2026-10-19','2');
function testPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 16 Tf 30 120 Td (Exact saved QA PDF) Tj ET';
  objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
  let pdf='%PDF-1.4\n', offsets=[0];
  objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});
  const start=pdf.length;
  pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  return new Blob([pdf+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF'],{type:'application/pdf'});
}
for (const [id,tid,x,time] of [['QA earlier PDF','territory-one',-105.04,'2022-01-01'],['QA PDF only','territory-pdf-only',-105.06,'2020-01-01']]) {
  const snapshot={hall:{id:'1',name:'QA meeting place'},congregation:'QA congregation',territory:{id:tid,name:'QA-01',geometry:polygon(x)},houses:[home(tid,x)]};
  const archive=await makePdfArchive(id,testPdf(),snapshot,{hallId:'1',territoryId:tid,territoryName:'QA-01',filename:id+'.pdf',updatedAt:time,planId:'Plan saved in 2021'});
  records.push(archive.record,...archive.parts);
}
const mock = `
const records = ${JSON.stringify(records)}, listeners = [];
let signedIn = true;
export const initializeApp=()=>({}),getAuth=()=>({}),getFirestore=()=>({}),browserLocalPersistence={};
export const setPersistence=async()=>{},sendPasswordResetEmail=async()=>{};
let authListener;
export const onAuthStateChanged=(_,callback)=>{authListener=callback;queueMicrotask(()=>callback({email:'michaeltarin@hotmail.com'}));};
export const signOut=async()=>{signedIn=false;authListener(null);};
export const signInWithEmailAndPassword=async()=>{signedIn=true;authListener({email:'michaeltarin@hotmail.com'});};
export const collection=(_,name)=>({name}),where=(field,op,value)=>({field,op,value}),query=(ref,...filters)=>({...ref,filters});
export const doc=(...args)=>({id:args.at(-1)}),serverTimestamp=()=>new Date().toISOString();
export const getDoc=async ref=>{const record=records.find(r=>r.id===ref.id);return{id:ref.id,exists:()=>!!record,data:()=>structuredClone(record)};};
export const onSnapshot=(ref,...args)=>{const callback=args.find(a=>typeof a==='function'); const notify=()=>callback({metadata:{hasPendingWrites:false,fromCache:false},forEach(fn){
if(ref.name==='reviews'&&signedIn) records.filter(r=>!ref.filters||ref.filters.every(f=>f.op==='in'?f.value.includes(r[f.field]):r[f.field]===f.value)).forEach(r=>fn({id:r.id,data:()=>structuredClone(r)}));
}});listeners.push(notify);queueMicrotask(notify);return()=>{};};
const deny=()=>{window.qaWrites=(window.qaWrites||0)+1;throw Error('QA preview forbids all writes');};
export const setDoc=deny,deleteDoc=deny,writeBatch=()=>({set:deny,delete:deny,commit:deny});
`;
const seed = `
houses=[{id:'unsaved-home',address:'UNSAVED WORK MUST STAY',lat:39.72,lng:-105.02,included:true,territoryId:'unsaved-territory'}];
territories=[{id:'unsaved-territory',name:'UNSAVED TERRITORY',colorIndex:0,houseIds:['unsaved-home']}];
selectedHouseIds=new Set(['unsaved-home']);focusedTerritoryId='unsaved-territory';
els.planName.value='UNSAVED PLAN — DO NOT REPLACE'; els.boundaryName.value='UNSAVED BOUNDARY NAME';
renderAllPlanningData();
const qaState=()=>JSON.stringify({houses,territories,selected:[...selectedHouseIds],focusedTerritoryId,currentPlanId,currentBoundaryId,boundaryGeometry,boundaryPreservesAddresses,workspaceGeneration,drawMode,activeTerritoryEditId,manualHouseMode,
inputs:Object.fromEntries(['hallSelect','congregationSelect','planName','boundaryName','territoryPrefix','sourceSelect','targetSize','groupingMethod'].map(id=>[id,els[id].value]))});
const baseline=qaState();
const check=document.createElement('button');check.id='qaCheck';check.textContent='Verify unsaved workspace';check.className='btn';
const report=document.createElement('p');report.id='qaReport';report.setAttribute('role','status');
check.addEventListener('click',()=>{report.textContent=qaState()===baseline&&!(window.qaWrites||0)?'PASS: all unsaved data, selections, plan identity, form values and edit state unchanged; zero writes.':'FAIL: workspace changed or a write was attempted';});
const qa=document.createElement('section');qa.className='card';qa.append(check,report);document.querySelector('.side-panel').prepend(qa);
`;
const server=createServer(async(req,res)=>{
  try {
    let pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname==='/test-store.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return;}
    if(pathname==='/assets/branding.js'){res.setHeader('Content-Type','text/javascript');res.end('// Branding integrations disabled in isolated QA.');return;}
    if(pathname.endsWith('/'))pathname+='index.html';
    const path=resolve(root,'.'+pathname);
    if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
    let content=await readFile(path);
    if(pathname==='/territories/bootstrap.js')content=content.toString().replace(/^  await import\((?!'\.\/app-main\.js)[^\n]+\n/gm,'');
    if(pathname==='/territories/app-main.js')content=content.toString().replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^']+/g,'/test-store.js')+seed;
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.txt':'text/plain'})[extname(path)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(content);
  }catch(error){res.writeHead(404).end(error.message);}
});
if (process.argv.includes('--standalone')) {
  const cache=new Map(), uri=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
  async function bundle(file) {
    if(cache.has(file))return cache.get(file);
    let source=file==='assets/branding.js'?'':file==='territories/data.js'
      ?gunzipSync(Buffer.from((await readFile(resolve(root,'territories/data.payload.txt'),'utf8')).trim(),'base64')).toString()
      :await readFile(resolve(root,file),'utf8');
    if(file==='territories/app-main.js')source+=seed;
    const imports=[...source.matchAll(/(?:from\s+|import\s+)'([^']+)'/g)];
    for(const match of imports) {
      const target=match[1];
      const replacement=target.startsWith('https://www.gstatic.com/firebasejs/')?uri(mock)
        :await bundle(resolve(root,dirname(file),target.split('?')[0]).slice(root.length+1).replaceAll('\\','/'));
      source=source.replace("'"+target+"'","'"+replacement+"'");
    }
    const result=uri(source);cache.set(file,result);return result;
  }
  const app=await bundle('territories/app-main.js');
  let html=await readFile(resolve(root,'territories/index.html'),'utf8');
  html=html.replace(/<body>[\s\S]*<\/body>/, '<body>'+await readFile(resolve(root,'territories/template.html'),'utf8')+'<script type="module" src="'+app+'"></script></body>');
  html=html.replace('</head>','<style>'+await readFile(resolve(root,'territories/styles.css'),'utf8')+'</style></head>');
  const output=resolve(root,'tmp/saved-territories-preview.html');await mkdir(dirname(output),{recursive:true});await writeFile(output,html);
  console.log(output);
} else server.listen(8786,'127.0.0.1',()=>console.log('Isolated saved-territory QA: http://127.0.0.1:8786/territories/'));
