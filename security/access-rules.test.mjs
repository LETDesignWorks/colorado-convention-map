import {before, after, beforeEach, test} from 'node:test';
import fs from 'node:fs';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, writeBatch} from 'firebase/firestore';
let env;
const ownerId = 'jPTl6zfkjaTbbCJMI7A7xXE2BN93';
const countPath='reviews/delegate-count-2027-07-16-hotel-H1';
const countRecord=()=>({recordType:'delegate-count',schemaVersion:1,date:'2027-07-16',category:'hotel',locationId:'H1',locationName:'Hotel One',locationAddress:'1 Main Street',count:50,notes:'Group A',revision:1,updatedByEmail:'helper@example.com',updatedAt:new Date()});
const user = (uid='helper',email='helper@example.com',verified=true) => env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
const owner = () => user(ownerId,'michaeltarin@hotmail.com');
const grant = (permissions, enabled=true) => ({recordType:'site-user-access',schemaVersion:1,email:'helper@example.com',enabled,permissions});
const seed = async (path, value) => env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),value));
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-convention-access',firestore:{rules:fs.readFileSync(new URL('./firestore.rules',import.meta.url),'utf8')}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearFirestore();});
test('delegate count editors can read missing entries, create, revise and remove only with Activity Planning permission',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'edit'}));const db=user();
 await assertSucceeds(getDoc(doc(db,'siteAccessCapabilities/delegateCountsV1')));await assertSucceeds(getDoc(doc(db,countPath)));
 await assertSucceeds(setDoc(doc(db,countPath),countRecord()));await assertSucceeds(getDocs(query(collection(db,'reviews'),where('recordType','==','delegate-count'))));
 await assertFails(updateDoc(doc(db,countPath),{count:60}));await assertSucceeds(updateDoc(doc(db,countPath),{count:60,revision:2}));await assertSucceeds(deleteDoc(doc(db,countPath)));
 await seed('reviews/site-access-helper@example.com',grant({routes:'edit',assignments:'edit',busAccess:'edit'}));await assertFails(setDoc(doc(db,countPath),countRecord()));
});
test('delegate counts stay private and viewers cannot write',async()=>{
 await seed(countPath,countRecord());await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),countPath)));
 await seed('reviews/site-access-helper@example.com',grant({routes:'view'}));await assertFails(getDoc(doc(user(),countPath)));
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'view'}));const db=user();await assertSucceeds(getDoc(doc(db,countPath)));await assertSucceeds(getDocs(query(collection(db,'reviews'),where('recordType','==','delegate-count'))));
 await assertFails(updateDoc(doc(db,countPath),{count:60,revision:2}));await assertFails(deleteDoc(doc(db,countPath)));
});
test('delegate counts reject invalid amounts, duplicate identities, unexpected fields and forged attribution',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'edit',busAccess:'edit'}));const db=user();
 for(const change of [{count:-1},{count:0.5},{count:100001},{count:'50'},{revision:2},{category:'unknown'},{locationId:'wrong'},{extra:'field'},{updatedByEmail:'other@example.com'}])await assertFails(setDoc(doc(db,countPath),{...countRecord(),...change}));
 await assertFails(setDoc(doc(db,'reviews/count-duplicate'),countRecord()));await assertFails(setDoc(doc(db,countPath),{name:'Pretend review'}));
 await assertSucceeds(setDoc(doc(db,countPath),{...countRecord(),count:0}));
});
test('assignment editors can save weekday records without changing addresses or meeting assignments',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({assignments:'edit'}));const db=user();
 const payload={recordType:'congregation-service-days',congregationId:'C001',congregationName:'First',serviceDays:['Monday','Thursday'],updatedBy:'Convention planning team'};
 await assertSucceeds(getDoc(doc(db,'siteAccessCapabilities/serviceDaysV1')));await assertSucceeds(setDoc(doc(db,'halls/congregation-service-days-c001'),payload));
 await assertFails(updateDoc(doc(db,'halls/congregation-service-days-c001'),{serviceDays:['Someday']}));await assertFails(updateDoc(doc(db,'halls/congregation-service-days-c001'),{meetingPointId:'26'}));
 await seed('reviews/site-access-helper@example.com',grant({assignments:'view'}));await assertFails(updateDoc(doc(db,'halls/congregation-service-days-c001'),{serviceDays:[]}));
 await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'halls/congregation-service-days-c001')));
});
test('suitability changes require Bus Access edit permission and preserve other hall fields',async()=>{
 await seed('halls/26',{name:'Castle Rock',busStatus:'approved',publicSummary:'Keep this review'});await seed('reviews/site-access-helper@example.com',grant({assignments:'edit'}));const db=user();await assertFails(updateDoc(doc(db,'halls/26'),{busStatus:'not-suitable',suitabilityRevision:1}));
 await seed('reviews/site-access-helper@example.com',grant({busAccess:'edit'}));await assertSucceeds(updateDoc(doc(db,'halls/26'),{busStatus:'not-suitable',suitabilityRevision:1}));
 const result=await getDoc(doc(db,'halls/26'));if(result.data().publicSummary!=='Keep this review')throw Error('Review details were lost');
});
test('assignment editors can assign multiple congregations to one rail station; viewers cannot',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({assignments:'edit'}));
 const db=user(),batch=writeBatch(db);
 for(const congregationId of ['C001','C002'])batch.set(doc(db,'halls/congregation-'+congregationId.toLowerCase()),{recordType:'congregation-assignment',congregationId,meetingPointId:'rtd-66',meetingPointType:'rail-station',meetingPointName:'10th / Osage Station',assigned:true});
 await assertSucceeds(batch.commit());await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'halls/congregation-c001')));
 await seed('reviews/site-access-helper@example.com',grant({assignments:'view'}));await assertFails(deleteDoc(doc(db,'halls/congregation-c001')));
});
test('imported travel cost estimates remain private to Activity Planning permissions',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'edit'}));const db=user();
 await assertSucceeds(setDoc(doc(db,'reviews/cost1'),{recordType:'activity-multistop-route',planningSubtype:'travel-cost-estimate',sourceTravelRouteId:'route1',estimateJson:'{}'}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'reviews/cost1')));
 await seed('reviews/site-access-helper@example.com',grant({routes:'view'}));await assertFails(getDoc(doc(db,'reviews/cost1')));
});
test('public maps remain public; private records and writes are denied',async()=>{
 await seed('halls/1',{name:'Hall'});await seed('reviews/1',{internalNotes:'Private'});
 const db=env.unauthenticatedContext().firestore();
 await assertSucceeds(getDocs(collection(db,'halls')));await assertSucceeds(getDoc(doc(db,'siteAccessCapabilities/v1')));
 await assertFails(getDoc(doc(db,'reviews/1')));await assertFails(setDoc(doc(db,'halls/2'),{name:'Other'}));
});
test('owner keeps all access; matching owner email with another UID does not',async()=>{
 await assertSucceeds(setDoc(doc(owner(),'reviews/site-access-helper@example.com'),grant({routes:'edit'})));
 await assertSucceeds(setDoc(doc(owner(),'reviews/photo-library-test'),{recordType:'photo-library'}));
 await assertSucceeds(getDocs(collection(owner(),'reviews')));
 await assertFails(getDocs(collection(user('impostor','michaeltarin@hotmail.com'),'reviews')));
});
test('only owner can manage policies; helpers can only get their own',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({routes:'edit'}));
 await seed('reviews/site-access-other@example.com',{...grant({}),email:'other@example.com'});
 const db=user();await assertSucceeds(getDoc(doc(db,'reviews/site-access-helper@example.com')));
 await assertFails(getDoc(doc(db,'reviews/site-access-other@example.com')));
 await assertFails(getDocs(query(collection(db,'reviews'),where('recordType','==','site-user-access'))));
 await assertFails(updateDoc(doc(db,'reviews/site-access-helper@example.com'),{permissions:{territories:'edit'}}));
 await assertFails(setDoc(doc(db,'reviews/site-access-attack@example.com'),{recordType:'bus-route'}));
 await assertFails(deleteDoc(doc(db,'reviews/site-access-helper@example.com')));
});
test('unverified, disabled, missing and invalid policies grant nothing',async()=>{
 const path='reviews/site-access-helper@example.com';
 await seed(path,grant({routes:'edit'}));
 await assertFails(setDoc(doc(user('helper','helper@example.com',false),'reviews/route'),{recordType:'bus-route'}));
 await seed(path,grant({routes:'edit'},false));
 await assertFails(setDoc(doc(user(),'reviews/route'),{recordType:'bus-route'}));
 await seed(path,{...grant({routes:'edit'}),schemaVersion:2});
 await assertFails(setDoc(doc(user(),'reviews/route'),{recordType:'bus-route'}));
 await assertFails(setDoc(doc(user('unknown','unknown@example.com'),'reviews/route'),{recordType:'bus-route'}));
});
test('viewers can query their section but cannot write or query other sections',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({routes:'view'}));
 await seed('reviews/route',{recordType:'bus-route'});await seed('reviews/plan',{recordType:'territory-plan'});
 const db=user();
 await assertSucceeds(getDocs(query(collection(db,'reviews'),where('recordType','in',['bus-route','rtd-station']))));
 await assertFails(getDocs(collection(db,'reviews')));
 await assertFails(getDoc(doc(db,'reviews/plan')));
 await assertFails(updateDoc(doc(db,'reviews/route'),{name:'Changed'}));
 await assertFails(deleteDoc(doc(db,'reviews/route')));
 await assertFails(setDoc(doc(db,'reviews/new'),{recordType:'bus-route'}));
});
test('editors can save their section; cannot change types or overwrite another section',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({routes:'edit'}));
 await seed('reviews/plan',{recordType:'territory-plan'});
 const db=user();await assertSucceeds(setDoc(doc(db,'reviews/route'),{recordType:'bus-route',name:'Route'}));
 await assertSucceeds(updateDoc(doc(db,'reviews/route'),{name:'Updated'}));
 await assertFails(updateDoc(doc(db,'reviews/route'),{recordType:'territory-plan'}));
 await assertFails(setDoc(doc(db,'reviews/plan'),{recordType:'bus-route'}));
 await assertFails(deleteDoc(doc(db,'reviews/plan')));
 await assertSucceeds(deleteDoc(doc(db,'reviews/route')));
});
test('public hall record types have separate edit permissions',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({assignments:'edit'}));
 await seed('halls/1',{name:'Hall'});await seed('halls/cart',{recordType:'smpw-location'});
 const db=user();await assertSucceeds(setDoc(doc(db,'halls/congregation-address-c001'),{recordType:'congregation-address',congregationId:'C001',lat:39.7,lng:-105}));
 await assertSucceeds(setDoc(doc(db,'halls/congregation-c001'),{recordType:'congregation-assignment',congregationId:'C001'}));
 await assertFails(updateDoc(doc(db,'halls/1'),{name:'Changed'}));
 await assertFails(deleteDoc(doc(db,'halls/cart')));
 await assertFails(setDoc(doc(db,'halls/1'),{recordType:'congregation-assignment'}));
 await assertFails(setDoc(doc(db,'halls/2'),{recordType:'congregation-assignment',congregationId:'C002',busStatus:'approved'}));
 await assertFails(updateDoc(doc(db,'halls/congregation-c001'),{busStatus:'approved',customLocation:true}));
});
test('SMPW and rail editors cannot inject meeting-location fields into public records',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({smpw:'edit',rail:'edit'}));
 const db=user();
 await assertSucceeds(setDoc(doc(db,'halls/abcdefghijklmnopqrst'),{recordType:'smpw-location',name:'Cart',lat:39.7,lng:-105}));
 await assertFails(updateDoc(doc(db,'halls/abcdefghijklmnopqrst'),{customLocation:true,busStatus:'approved'}));
 await assertSucceeds(setDoc(doc(db,'halls/rail-hotel-hall'),{recordType:'south-dtc-rail-connection',hotelId:'hotel',meetingPointId:'hall'}));
 await assertFails(updateDoc(doc(db,'halls/rail-hotel-hall'),{busStatus:'approved'}));
});
test('bus review access covers contacts, missing reviews and traffic layouts, not photos or policies',async()=>{
 await seed('reviews/site-access-helper@example.com',grant({busAccess:'edit'}));
 await seed('reviews/photo-library-1',{recordType:'photo-library'});
 const db=user();await assertSucceeds(getDoc(doc(db,'reviews/1')));
 await assertSucceeds(setDoc(doc(db,'reviews/1'),{contact1:{name:'Contact'},trafficLayoutsJson:'{}'}));
 await assertSucceeds(setDoc(doc(db,'halls/1'),{name:'Hall',busStatus:'approved'}));
 await assertFails(getDoc(doc(db,'reviews/photo-library-1')));
 await assertFails(setDoc(doc(db,'reviews/photo-library-2'),{trafficLayoutsJson:'{}'}));
});
test('all typed private sections support scoped queries and immediate revocation',async()=>{
 const groups={territories:['territory-boundary','territory-plan','territory-plan-chunk','territory-pdf','territory-name-choice'],activities:['activity-bus-plan'],activityPlanning:['activity-multistop-route']};
 for(const[section,types]of Object.entries(groups)){
  await seed('reviews/site-access-helper@example.com',grant({[section]:'edit'}));
  await assertSucceeds(getDocs(query(collection(user(),'reviews'),where('recordType','in',types))));
  await assertSucceeds(setDoc(doc(user(),'reviews/'+section),{recordType:types[0]}));
 }
 await seed('reviews/site-access-helper@example.com',grant({},false));
 await assertFails(getDoc(doc(user(),'reviews/activityPlanning')));
});
test('bus-group plans use existing Activity Planning permissions for create, read, revise and delete',async()=>{
 const path='reviews/bus-group-permissions',payload={recordType:'activity-multistop-route',planningSubtype:'bus-group-plan',busGroupsVersion:1,planName:'Multiple groups',groupsJson:'{"version":1,"groups":[]}',revision:1,updatedByEmail:'helper@example.com',updatedAt:new Date()};
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'edit'}));const db=user();
 await assertSucceeds(setDoc(doc(db,path),payload));await assertSucceeds(getDoc(doc(db,path)));await assertSucceeds(getDocs(query(collection(db,'reviews'),where('recordType','==','activity-multistop-route'))));await assertSucceeds(updateDoc(doc(db,path),{revision:2,planName:'Updated bus departures'}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'view'}));await assertSucceeds(getDoc(doc(db,path)));await assertFails(updateDoc(doc(db,path),{revision:3}));await assertFails(deleteDoc(doc(db,path)));
 await seed('reviews/site-access-helper@example.com',grant({routes:'edit'}));await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,'reviews/another-bus-group'),payload));
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'edit'}));await assertSucceeds(deleteDoc(doc(db,path)));
});

test('daily hosting plans are private and editable only with Congregation Assignments permission',async()=>{
 const path='reviews/hosting-example',payload={recordType:'congregation-hosting-plan',schemaVersion:1,planName:'May hosting',planJson:'{}',revision:1,updatedByEmail:'helper@example.com',updatedAt:new Date()};
 await seed('reviews/site-access-helper@example.com',grant({assignments:'edit'}));const db=user();await assertSucceeds(getDoc(doc(db,'siteAccessCapabilities/hostingPlansV1')));
 await assertSucceeds(setDoc(doc(db,path),payload));await assertSucceeds(getDoc(doc(db,path)));await assertSucceeds(getDocs(query(collection(db,'reviews'),where('recordType','==','congregation-hosting-plan'))));
 await assertFails(updateDoc(doc(db,path),{planName:'Without revision'}));await assertSucceeds(updateDoc(doc(db,path),{planName:'Updated',revision:2}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));
 for(const changes of [{revision:2},{schemaVersion:2},{unexpected:'bad'},{updatedByEmail:'someone@example.com'}])await assertFails(setDoc(doc(db,'reviews/bad-hosting'),{...payload,...changes}));
 await seed('reviews/site-access-helper@example.com',grant({assignments:'view'}));await assertSucceeds(getDoc(doc(db,path)));await assertFails(updateDoc(doc(db,path),{revision:3}));await assertFails(deleteDoc(doc(db,path)));
 await seed('reviews/site-access-helper@example.com',grant({activityPlanning:'edit',routes:'edit'}));await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,'reviews/no-hosting-access'),payload));
 await seed('reviews/site-access-helper@example.com',grant({assignments:'edit'}));await assertSucceeds(deleteDoc(doc(db,path)));
});
