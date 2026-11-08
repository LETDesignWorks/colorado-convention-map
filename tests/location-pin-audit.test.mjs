import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {driveTimeEstimateFor} from '../bus-access/drive-time-area.mjs';

const audit=JSON.parse(fs.readFileSync('bus-access/location-pin-audit.json','utf8'));
const halls=JSON.parse(fs.readFileSync('bus-access/data.js','utf8').match(/export const HALLS=(\[[^;]+\]);/)[1]);
const extra=vm.runInNewContext('('+fs.readFileSync('territories/halls.js','utf8').match(/const CCC_ONLY_ADDITIONS = (\[[\s\S]+?\n\]);/)[1]+')');

test('every location and both territory-only records have a distinct audit result',()=>{
  assert.equal(audit.locations.length,32);
  assert.equal(new Set(audit.locations.map(row=>row.id)).size,32);
  assert.equal(audit.locations.filter(row=>row.action==='correct').length,25);
  for(const row of audit.locations){
    assert.match(row.sourceUrl,/^https:\/\/www\.google\.com\/maps\/place\//);
    assert.ok(row.evidence.includes('Address'));
    assert.ok(row.verifiedPoint.every(Number.isFinite));
    assert.equal(row.action,row.offsetMeters>25?'correct':'keep');
  }
});

test('all built-in pins use their audited coordinate or retain the close match',()=>{
  for(const hall of halls){
    const row=audit.locations.find(row=>row.id===hall.id);
    assert.equal(hall.address,row.address);
    assert.deepEqual([hall.lat,hall.lng],row.action==='correct'?row.verifiedPoint:row.originalPoint);
    if(row.action==='correct')assert.equal(driveTimeEstimateFor(hall),null,'Old travel estimate must not follow a moved pin');
  }
  assert.ok(driveTimeEstimateFor(halls.find(hall=>hall.id==='1')));
});

test('Westminster and Brighton territory pins match the verified address points',()=>{
  for(const hall of extra){
    const row=audit.locations.find(row=>row.id==='territory-'+hall.id);
    assert.deepEqual([hall.lat,hall.lng],row.verifiedPoint);
  }
  assert.deepEqual(audit.locations.find(row=>row.id==='territory-12').verifiedPoint,
    audit.locations.find(row=>row.id==='v7fIJgtw2xclQMQBYV5G').verifiedPoint);
});
