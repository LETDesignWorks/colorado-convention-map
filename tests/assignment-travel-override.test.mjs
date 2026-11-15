import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assignments/app-v3.mjs',import.meta.url),'utf8');
function fixture(){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,hidden:false,textContent:''});return elements.get(id);};
 const congregations=[{id:'near',name:'Near',sourceName:'Near'},{id:'far',name:'Far',sourceName:'Far'},{id:'missing',name:'Missing',sourceName:'Missing'}],states=new Map([['near',{status:'within',allowed:true}],['far',{status:'over',allowed:false}],['missing',{status:'unknown',allowed:false}]]);
 const writes=[],messages=[];let admin=true,pending=null,fail=false;
 const els=Object.fromEntries(['assignmentDestination','selectionCount','assignSelectedButton','unassignSelectedButton','clearSelectionButton'].map(id=>[id,get(id)]));els.assignmentDestination.value='meeting';
 const ctx=vm.createContext({assignmentBusy:false,selectionRevision:0,isAdmin:()=>admin,publicReady:true,locations:[{id:'meeting',name:'Meeting',locationType:'kingdom-hall'},{id:'other',name:'Other',locationType:'rail-station'}],els,CONGREGATIONS:congregations,selectedCongregations:new Set(['near','far']),revealedCongregations:new Set(),assignments:new Map(),driveState:c=>states.get(c.id),drives:{ensure:async()=>{if(pending)await pending;}},resolveHome:()=>({address:'123 Main St',point:{lat:39.7,lng:-105}}),document:{getElementById:get},renderServiceDays(){},renderStats(){},renderCongregationList:()=>ctx.renderSelectionControls(),renderAll:()=>ctx.renderSelectionControls(),openLogin(){},db:{},currentUser:{email:'editor@example.test'},doc:(_db,_collection,id)=>id,assignmentDocumentId:id=>'congregation-'+id,serverTimestamp:()=>123,markerLabel:p=>p.id,writeBatch:()=>{const staged=[];return {set:(id,data)=>staged.push({id,data}),commit:async()=>{if(fail)throw Error('Save failed');writes.push(...staged);}};},toast:message=>messages.push(message),friendlyError:error=>error.message});
 for(const [start,end]of [['let travelOverridePointId=','const availableMeetingPoints='],['async function requireEligible(','const els ='],['function renderSelectionControls()','function renderCongregationList()'],['async function assignSelected()','async function clearSelectedAssignments()'],['async function saveAssignment(','document.getElementById(\'retryDriveTimes\')']])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),ctx);
 return {ctx,get,congregations,states,writes,messages,admin:value=>admin=value,pending:value=>pending=value,fail:value=>fail=value};
}
test('override only admits verified over-limit journeys for its chosen meeting point',async()=>{
 const f=fixture(),{ctx}=f;await assert.rejects(ctx.requireEligible([f.congregations[1]],ctx.locations[0]));
 ctx.setTravelOverride('meeting',true);await ctx.requireEligible(f.congregations.slice(0,2),ctx.locations[0]);
 await assert.rejects(ctx.requireEligible([f.congregations[1]],ctx.locations[1]));
 for(const status of ['unknown','missing','pending','no-destination']){f.states.set('missing',{status,allowed:false});await assert.rejects(ctx.requireEligible([f.congregations[2]],ctx.locations[0]));}
 f.admin(false);assert.equal(ctx.travelOverrideEnabled('meeting'),false);await assert.rejects(ctx.requireEligible([f.congregations[1]],ctx.locations[0]));
});
test('directory and map assign buttons enable together while the over-limit warning remains',()=>{
 const f=fixture(),{ctx}=f;ctx.renderSelectionControls();assert.equal(f.get('mapAssignSelected').disabled,true);assert.equal(f.get('assignSelectedButton').disabled,true);
 ctx.setTravelOverride('meeting',true);for(const id of ['mapOverrideTravelLimit','overrideTravelLimit'])assert.equal(f.get(id).checked,true);
 assert.equal(f.get('mapAssignSelected').disabled,false);assert.equal(f.get('assignSelectedButton').disabled,false);assert.match(f.get('selectionTravelStatus').textContent,/Override enabled/);assert.match(f.get('selectionTravelStatus').textContent,/exceed 1 hr 20 min/);
 ctx.selectedCongregations.add('missing');ctx.renderSelectionControls();assert.equal(f.get('mapAssignSelected').disabled,true);assert.match(f.get('selectionTravelStatus').textContent,/verified address/);
 ctx.els.assignmentDestination.value='other';ctx.renderSelectionControls();assert.equal(f.get('overrideTravelLimit').checked,false);assert.equal(f.get('mapAssignSelected').disabled,true);
});
test('bulk and single overrides save ordinary persistent assignments and clear the override after success',async()=>{
 const f=fixture();f.ctx.setTravelOverride('meeting',true);await f.ctx.assignSelected();assert.equal(f.writes.length,2);assert.equal(f.ctx.assignments.get('far').meetingPointId,'meeting');assert.equal(f.ctx.travelOverrideEnabled('meeting'),false);assert.equal(f.ctx.selectedCongregations.size,0);
 for(const {data}of f.writes){assert.equal(data.recordType,'congregation-assignment');assert.equal(data.assigned,true);assert.equal(data.updatedByEmail,'editor@example.test');}
 const g=fixture();g.ctx.setTravelOverride('other',true);await g.ctx.saveAssignment(g.congregations[1],'other');assert.equal(g.writes.length,1);assert.equal(g.writes[0].data.meetingPointType,'rail-station');assert.equal(g.ctx.assignments.get('far').meetingPointId,'other');assert.equal(g.ctx.travelOverrideEnabled('other'),false);
});
test('failed writes keep the override for retry; access or override withdrawal during travel lookup prevents saving',async()=>{
 const f=fixture();f.ctx.setTravelOverride('meeting',true);f.fail(true);await f.ctx.assignSelected();assert.equal(f.writes.length,0);assert.equal(f.ctx.travelOverrideEnabled('meeting'),true);assert.equal(f.ctx.selectedCongregations.size,2);
 for(const revoke of ['access','override']){const g=fixture();g.ctx.setTravelOverride('meeting',true);let finish;g.pending(new Promise(resolve=>finish=resolve));const saving=g.ctx.saveAssignment(g.congregations[1],'meeting');if(revoke==='access')g.admin(false);else g.ctx.setTravelOverride('meeting',false);finish();await assert.rejects(saving);assert.equal(g.writes.length,0);}
});
