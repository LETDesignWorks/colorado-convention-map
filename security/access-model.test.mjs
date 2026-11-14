import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OWNER_UID,SECTIONS,permission,policyId,cleanPermissions} from '../assets/access-model.mjs';
const user={uid:'helper',email:'Helper@Example.com',emailVerified:true};
const policy={schemaVersion:1,email:'helper@example.com',enabled:true,permissions:{assignments:'edit',territories:'view'}};
test('owner cannot be locked out by a disabled policy or unavailable setup',()=>{
 for(const {id} of SECTIONS)assert.equal(permission({uid:OWNER_UID},null,id,false),'edit');
});
test('permissions default closed; verified users get only their configured sections',()=>{
 assert.equal(permission(user,policy,'assignments'),'edit');
 assert.equal(permission(user,policy,'territories'),'view');
 assert.equal(permission(user,policy,'busAccess'),'none');
 for(const account of [null,{...user,emailVerified:false},{...user,email:'other@example.com'}])assert.equal(permission(account,policy,'assignments'),'none');
 assert.equal(permission(user,policy,'assignments',false),'none');
 assert.equal(permission(user,{...policy,enabled:false},'assignments'),'none');
 assert.equal(permission(user,{...policy,schemaVersion:2},'assignments'),'none');
});
test('policy keys normalize emails without allowing path injection',()=>{
 assert.equal(policyId(' Helper@Example.COM '),'site-access-helper@example.com');
 for(const bad of ['a/b@example.com','noemail','','x@','a b@example.com'])assert.throws(()=>policyId(bad));
});
test('malformed levels and unknown sections never become privileges',()=>{
 assert.equal(cleanPermissions({assignments:'admin',territories:'view',unknown:'edit'}).assignments,'none');
 assert.equal(cleanPermissions({territories:'view'}).territories,'view');
 assert.equal(Object.hasOwn(cleanPermissions({unknown:'edit'}),'unknown'),false);
});
