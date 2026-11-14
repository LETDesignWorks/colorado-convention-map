import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {owner,permission,policyId,OWNER_UID} from '../assets/access-model.mjs';
const source=fs.readFileSync(new URL('../assets/site-access.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
function harness(probe=true){
 let authChanged,policyChanged,policyError;
 const values=[];
 const context=vm.createContext({owner,permission,policyId,
  onIdTokenChanged:(_auth,callback)=>{authChanged=callback;return()=>{};},
  getFirestore:()=>({}),doc:(_db,...parts)=>parts.join('/'),
  getDocFromServer:async()=>{if(!probe)throw Error('permission-denied');return{};},
  onSnapshot:(_ref,_options,next,error)=>{policyChanged=next;policyError=error;return()=>{policyChanged=null;};},
  window:{dispatchEvent:()=>{}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}
 });
 vm.runInContext(source,context);context.capture=user=>values.push(user?.uid||null);
 vm.runInContext('observeSiteAccess({app:{}},capture)',context);
 return {login:user=>authChanged(user),read:()=>vm.runInContext("canEdit('assignments')",context),view:()=>vm.runInContext("canView('assignments')",context),snapshot:(policy,meta={fromCache:false,hasPendingWrites:false})=>policyChanged({metadata:meta,exists:()=>!!policy,data:()=>policy}),fail:()=>policyError(Error('lost access')),values};
}
const user={uid:'helper',email:'helper@example.com',emailVerified:true};
const policy={schemaVersion:1,email:user.email,enabled:true,permissions:{assignments:'edit'}};
test('no delegated access before server setup and policy have been confirmed',async()=>{
 const missing=harness(false);await missing.login(user);assert.equal(missing.read(),false);
 const live=harness();await live.login(user);assert.equal(live.read(),false);
 live.snapshot(policy,{fromCache:true,hasPendingWrites:false});assert.equal(live.read(),false);
 live.snapshot(policy,{fromCache:false,hasPendingWrites:true});assert.equal(live.read(),false);
 live.snapshot(policy);assert.equal(live.read(),true);
});
test('permission downgrade, revocation and sign-out immediately remove editing',async()=>{
 const live=harness();await live.login(user);live.snapshot(policy);assert.equal(live.read(),true);
 live.snapshot({...policy,permissions:{assignments:'view'}});assert.equal(live.read(),false);assert.equal(live.view(),true);
 live.snapshot({...policy,enabled:false});assert.equal(live.view(),false);
 live.snapshot(policy);await live.login(null);assert.equal(live.read(),false);
});
test('policy errors and unverified accounts fail closed',async()=>{
 const live=harness();await live.login(user);live.snapshot(policy);live.fail();assert.equal(live.read(),false);
 await live.login({...user,emailVerified:false});assert.equal(live.read(),false);
});
test('owner editing remains available before permission setup',async()=>{
 const live=harness(false);await live.login({uid:OWNER_UID});assert.equal(live.read(),true);
});
