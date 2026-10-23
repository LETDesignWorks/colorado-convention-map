from pathlib import Path

def edit(path, old, new):
    p=Path(path); s=p.read_text()
    assert old in s, f'Missing expected source in {path}: {old[:90]}'
    p.write_text(s.replace(old,new,1))

p='tests/library-release.test.mjs'
edit(p,"savedRecordsStatus:'ready',selectedHall:hall,currentUser", "savedRecordsStatus:'ready',selectedHall:hall,selectedCongregation:'A',libraryChoice:()=>null,libraryNameKey:n=>String(n).toUpperCase(),currentUser")
edit(p,"writeBatch:()=>{let entry;return{set:(ref,record)=>{entry=[ref.id,record]},commit:async()=>{commits++;if(failPart===commits)throw Error('chunk failed');writes.push(entry[0]);stored.set(...entry)}}}", "writeBatch:()=>{const entries=[];return{set:(ref,record)=>{entries.push([ref.id,record])},commit:async()=>{commits++;if(failPart===commits)throw Error('chunk failed');for(const entry of entries){writes.push(entry[1].recordType==='territory-plan'?'manifest':entry[0]);stored.set(...entry)}}}}")
with Path(p).open('a') as f:
    f.write('''\n
test('complete session atomically publishes manifest and all exact kept-version choices',async()=>{
 const h=writeHarness(),snapshot={hallId:'a',congregation:'A',boundary:null,houses:[{id:'1'},{id:'2'}],territories:[{id:'t',name:'T1'},{id:'u',name:'T2',congregation:'B'}]};
 const id=await h.context.save(snapshot,{kind:'work',sessionScope:'meeting-place'});
 const record=h.stored.get(id),choices=[...h.stored.values()].filter(r=>r.recordType==='territory-name-choice');
 assert.equal(record.sessionScope,'meeting-place');assert.equal(choices.length,2);
 assert.ok(choices.every((c,i)=>JSON.parse(c.versionId)[1]===id));
 assert.equal(JSON.parse(record.territoriesJson)[1].congregation,'B');
 const failed=writeHarness(3);await assert.rejects(failed.context.save(snapshot,{kind:'work',sessionScope:'meeting-place'}),/chunk failed/);
 assert.equal([...failed.stored.values()].filter(r=>['territory-plan','territory-name-choice'].includes(r.recordType)).length,0);
});
''')

edit('territories/saved-territories-model.js','congregation: text(record.congregation),','congregation: text(territory.congregation || record.congregation),')

p='territories/meeting-session-model.js'
edit(p,'  let result = clone(workspace);\n', '''  let result = clone(workspace);
  // A deliberate removal must also suppress matching copies from an older base.
  const liveNamesAtStart = new Set(workspace.territories.map(named));
  const removed = new Set((workspace.removedTerritoryNames || []).filter(name => !liveNamesAtStart.has(name)));
''')
edit(p,'    result = checkedMerge(result, { ...clone(base), id: base.id || \'session-base\', label: \'Complete saved location\' }, true);', '''    const retainedBase = clone(base), removedIds = new Set(retainedBase.territories.filter(t => removed.has(named(t))).map(t => id(t.id)));
    retainedBase.territories = retainedBase.territories.filter(t => !removedIds.has(id(t.id)));
    retainedBase.houses.forEach(h => { if (removedIds.has(id(h.territoryId))) h.territoryId = null; if (removedIds.has(id(h.avoidTerritoryId))) h.avoidTerritoryId = null; });
    result = checkedMerge(result, { ...retainedBase, id: base.id || 'session-base', label: 'Complete saved location' }, true);''')
edit(p,'  const removed = new Set(workspace.removedTerritoryNames || []);\n  for (const group of groups)', '  for (const group of groups)')
edit(p,'    if (existing && group.keptVersionId && !dirty.has(id(existing.id)) && !selected) {','    if (existing && !dirty.has(id(existing.id)) && !(selected && (named(existing) === named(selected.territory) || id(existing.id) === id(selected.territory.id)))) {')
edit(p,"  result.sessionScope = 'meeting-place'; result.editId = null; result.editing = false;", "  result.removedTerritoryNames = [...removed].filter(name => !result.territories.some(t => named(t) === name));\n  result.sessionScope = 'meeting-place'; result.editId = null; result.editing = false;")

p='territories/saved-territories-layer.js'
edit(p,"        try { await sessionManager.checkAddresses(version, { scan }); }\n        catch (error) { if (message.isConnected) message.textContent = error.message; }\n        finally { libraryBusy = false; if (active()) { regroupNames(); renderMap(); renderList(); renderDetail(); summary(); } }", """        let failure = '';
        try { await sessionManager.checkAddresses(version, { scan }); }
        catch (error) { failure = error.message; }
        finally { libraryBusy = false; if (active()) { regroupNames(); renderMap(); renderList(); renderDetail(); summary();
          const feedback = el('territoryMembershipStatus'); if (feedback) feedback.textContent = failure || 'Boundary review finished. See the session status above, then SAVE YOUR WORK to retain changes.';
        } }""")

p='territories/territory-membership.js'
edit(p,'{ moveConflicts = false } = {})','{ moveConflicts = false, releaseOutside = false } = {})')
edit(p,'  for (const home of review.unassigned) home.territoryId = tid(territoryId);','  for (const home of review.unassigned) home.territoryId = tid(territoryId);\n  if (releaseOutside) for (const home of review.outsideAssigned) home.territoryId = null;')
p='territories/meeting-session-service.js'
edit(p,"      if (stamp !== sessionContentStamp(host.capture())) throw new Error('Your session changed during review. Run the boundary check again.');", """      const releaseOutside = review.outsideAssigned.length ? await host.confirm(`${review.outsideAssigned.length} homes are assigned to ${version.territory.name} but lie outside its boundary. Return those homes to Unassigned? Their addresses will remain in the session. Cancel keeps their current assignments.`) : false;
      if (stamp !== sessionContentStamp(host.capture())) throw new Error('Your session changed during review. Run the boundary check again.');""")
edit(p,'{ moveConflicts });','{ moveConflicts, releaseOutside });')

with Path('tests/meeting-session.test.mjs').open('a') as f:
    f.write('''\n
test('an unchanged session uses the same default version shown in the saved library',()=>{
 const w=workspace([home('1','5')],[territory('5')]);w.dirtyTerritoryIds=[];
 const v=version(territory('newer','5'),[home('2','newer')]);const result=assembleMeetingSession(w,[group(v)]);
 assert.equal(result.territories[0].id,'newer');assert.ok(result.houses.some(h=>h.id==='1'));
});
test('removing a territory prevents older base resurrection but preserves its homes',()=>{
 const w=workspace([home('1')]);w.removedTerritoryNames=['5'];
 const base=workspace([home('1','5'),home('2','5')],[territory('5')]);
 const result=assembleMeetingSession(w,[],{base});assert.equal(result.territories.length,0);assert.equal(result.houses.length,2);assert.ok(result.houses.every(h=>!h.territoryId));
});
test('recreating a removed territory name clears the persisted removal',()=>{
 const w=workspace([home('1','replacement')],[territory('replacement','5')]);w.removedTerritoryNames=['5'];
 const result=assembleMeetingSession(w,[]);assert.equal(result.territories.length,1);assert.deepEqual(result.removedTerritoryNames,[]);
});
test('saved session collection preserves per-territory congregation metadata',async()=>{
 const {collectSavedTerritories}=await import('../territories/saved-territories-model.js');
 const records=new Map([['p',{id:'p',recordType:'territory-plan',hallId:'21',congregation:'A',houseCount:1,chunkIds:['c'],territories:[territory('5','5',{congregation:'B'})]}],['c',{id:'c',recordType:'territory-plan-chunk',planId:'p',houses:[home('1','5')]}]]);
 const result=await collectSavedTerritories({records,hallId:'21',readSnapshot:async()=>{throw Error('unexpected');}});
 assert.equal(result.groups[0].versions[0].congregation,'B');
});
test('outside-assigned homes move to unassigned only with explicit consent',()=>{
 const w=workspace([home('1','5',{lat:39.9})],[territory('5')]);
 assert.equal(fillBoundaryMembership(w,'5',turf).draft.houses[0].territoryId,'5');
 const result=fillBoundaryMembership(w,'5',turf,{releaseOutside:true}).draft;
 assert.equal(result.houses[0].territoryId,null);assert.equal(result.houses.length,1);assert.equal(w.houses[0].territoryId,'5');
});
''')
print('Updated atomic save test harness and checked whole-session metadata and review behavior.')
