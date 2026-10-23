from pathlib import Path
p=Path('tests/saved-work-integration.test.mjs')
s=p.read_text();old="    savedTerritoryEditId: null, workspaceGeneration: 1,";assert s.count(old)==1
s=s.replace(old,"    meetingSessionScope: '', sessionRemovedNames: [],\n"+old)
s+='''\n
test('complete-session scope and removed names survive ordinary saved-plan serialization',async()=>{
 const h=harness();h.context.meetingSessionScope='meeting-place';h.context.sessionRemovedNames=['OLD TERRITORY'];
 const id=await h.save({saveYourWork:true});assert.equal(h.stored.get(id).sessionScope,'meeting-place');assert.deepEqual(h.stored.get(id).sessionRemovedTerritoryNames,['OLD TERRITORY']);
});
test('a complete current session never rereads its older base when upload resets currentPlanId',()=>{
 const code=section(main,'function readSessionBase(workspace) {','\nfunction applyMeetingSession');
 const ctx={currentWorkFor(){throw Error('Unexpected older base read')},savedPlans(){return []},readPlanAddresses(){throw Error('Unexpected address reload')},reviewRecords:new Map()};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 assert.equal(ctx.readSessionBase({sessionScope:'meeting-place',currentPlanId:null,hallId:'21',congregation:'Test'}),null);
});
test('load, capture and apply paths retain the complete-session marker; resets clear it',()=>{
 assert.match(section(main,'function loadPlanRecord(id) {','\nfunction updateSavedTerritoryEditUi'),/meetingSessionScope = plan.sessionScope/);
 assert.match(section(main,'function sessionWorkspace() {','\nfunction captureMeetingSession'),/sessionScope: meetingSessionScope/);
 assert.match(section(main,'function applyMeetingSession(draft','\nconst meetingSessionManager'),/meetingSessionScope = draft.sessionScope/);
 assert.match(section(main,'function clearPlanWorkspace(','\nfunction ',),/meetingSessionScope = ''/);
});
'''
p.write_text(s)
p=Path('territories/address-duplicates-ui.js');s=p.read_text();old="      window.dispatchEvent(new window.CustomEvent('territory-planner:duplicates-cleaned'));";assert s.count(old)==1
s=s.replace(old,"      if(api.isAdmin() && hallAtStart===String(api.getSelectedHall()?.id||'') && territoryAtStart!=null) selectId(territoryAtStart);\n"+old)
p.write_text(s)
p=Path('tests/address-duplicates-flow.test.mjs');s=p.read_text();s+='''\n
test('review remaining matches uses the cleaned session even without a saved-library refresh listener',async()=>{
 const x=uiHarness();x.h.current.houses.push(home('c',{address:'100 Test Dr'}),home('d',{address:'100 Test Dr',lat:39.541}));x.h.current.territories[0].houseIds.push('c','d');
 x.ui.selectVersion({id:'old-pdf',source:'pdf',hallId:'21',territory:structuredClone(x.h.current.territories[0]),houses:structuredClone(x.h.current.houses)});
 document.getElementById('scanSelectedDuplicates').click();await settle();document.getElementById('applyDuplicateCleanup').click();await settle();
 assert.equal(x.h.current.houses.length,3);document.getElementById('reviewRemainingDuplicates').click();await settle();
 assert.equal(document.querySelectorAll('[data-duplicate-group]').length,1);assert.match(document.getElementById('duplicateScanStatus').textContent,/1 repeated/);x.dom.window.close();
});
''';p.write_text(s)
