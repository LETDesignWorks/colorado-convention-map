import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('territories/assessor-full-boundary.js','utf8').replace(/\r\n/g,'\n');
function harness() {
  const homes=[{id:'a',address:'100 Example St',lat:39.5,lng:-105,territoryId:'T1',included:true},
    {id:'avoid',address:'102 Example St',lat:39.5,lng:-105,avoid:true,included:false},
    {id:'excluded',address:'104 Example St',lat:39.5,lng:-105,included:false}];
  const original=structuredClone(homes); let current=true,dedupes=0;
  const context={cancelFullBoundary:false,console,document:{getElementById:()=>({checked:true})},clean:v=>String(v||'').trim(),
    normalizeAddressKey:v=>String(v).toLowerCase(),parseSourceFeature:(_,v)=>v,validCoordinates:v=>Number.isFinite(v.lat)&&Number.isFinite(v.lng),
    updateProgress(){},nextFrame:async()=>{},scanScopeIsCurrent:()=>current};
  const planner={getHouses:()=>homes,pointInsideBoundary:v=>v.lng<=-104,uniqueId:(()=>{let n=0;return()=>`new-${++n}`;})(),dedupeHouses(){dedupes++;}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function addressKey('),source.indexOf('function cancelActiveRequests(')),context);
  return {context,planner,homes,original,merge:features=>context.mergeFeatures(planner,'test',features,{}),stale:()=>current=false,dedupes:()=>dedupes};
}
const home=(id,address,extra={})=>({id,address,lat:39.5,lng:-105,residential:true,...extra});
test('GIS fill preserves assignments, avoid records, exclusions and separate apartments',async()=>{
 const h=harness();const result=await h.merge([home('same','100 Example St'),home('v','102 Example St'),home('e','104 Example St'),home('u1','110 Example St Apt 1'),home('u2','110 Example St Apt 2')]);
 assert.deepEqual(h.homes.slice(0,3),h.original);assert.equal(result.added,2);assert.equal(result.duplicates,3);assert.equal(h.dedupes(),0);assert.equal(h.homes.at(-1).territoryId,null);
});
test('outside, unusable and nonresidential source records do not enter the home set',async()=>{
 const h=harness();const result=await h.merge([home('outside','200 Example',{lng:-103}),home('invalid','202 Example',{lat:NaN}),home('office','204 Example',{residential:false}),home('ok','206 Example')]);
 assert.equal(result.added,1);assert.equal(result.outside,1);assert.equal(result.unusable,1);assert.equal(result.nonResidential,1);
});
test('stale workspace cannot receive staged GIS data',async()=>{
 const h=harness();h.stale();const result=await h.merge([home('x','500 Example')]);assert.equal(result.added,0);assert.deepEqual(h.homes,h.original);
});
test('cancellation during staging leaves the original workspace untouched',async()=>{
 const h=harness();h.context.nextFrame=async()=>{h.context.cancelFullBoundary=true;};const result=await h.merge(Array.from({length:650},(_,i)=>home(`n-${i}`,`${1000+i} New St`)));
 assert.equal(result.added,0);assert.deepEqual(h.homes,h.original);
});
test('late upload duplicates are rechecked before committing scan additions',async()=>{
 const h=harness();let done=false;h.context.nextFrame=async()=>{if(!done){h.homes.push(home('upload','1000 New St'));done=true;}};
 const result=await h.merge(Array.from({length:350},(_,i)=>home(`n-${i}`,`${1000+i} New St`)));
 assert.equal(h.homes.filter(home=>home.address==='1000 New St').length,1);assert.equal(result.added,349);
});
test('existing GIS source IDs cannot displace loaded homes',async()=>{
 const h=harness();await h.merge([home('a','999 Different St')]);assert.equal(new Set(h.homes.map(h=>h.id)).size,h.homes.length);assert.deepEqual(h.homes[0],h.original[0]);
});
test('manual and generic import entry points retain outside points for review',()=>{
 const app=fs.readFileSync('territories/app-main.js','utf8');const missing=app.slice(app.indexOf('async function addMissingAddress'),app.indexOf('async function loadAddresses'));
 assert.doesNotMatch(missing,/outside the current congregation boundary/);
 const imported=app.slice(app.indexOf('async function importAddressFile'),app.indexOf('function houseStyle'));
 assert.match(imported,/records\.filter\(validMapCoordinates\)/);assert.doesNotMatch(imported,/dedupeAddressRecords\(records\)/);
 assert.match(app,/saveMeetingPlaceBoundary/);assert.match(app,/getWorkspaceGeneration/);
});
