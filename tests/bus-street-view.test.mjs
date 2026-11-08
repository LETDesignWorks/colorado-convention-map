import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { driveTimeEstimateFor } from '../bus-access/drive-time-area.mjs';

const source = fs.readFileSync('bus-access/app-v2.js', 'utf8');
const halls = JSON.parse(fs.readFileSync('bus-access/data.js', 'utf8').match(/export const HALLS=(\[[^;]+\]);/)[1]);
const westminster = {id:'custom', address:'11580 Sheridan Blvd, Westminster, CO 80020', lat:39.906674, lng:-105.052898};
const context = vm.createContext({clean:value=>String(value??'').trim(), selectedId:'19', locations:[...halls,westminster]});
vm.runInContext(source.slice(source.indexOf('function mapQuery('),source.indexOf('function friendlyError(')), context);

test('Yale Avenue uses the verified property pin and no longer displays travel times for the old pin', () => {
  const yale = halls.find(h=>h.id==='19');
  assert.deepEqual([yale.lat,yale.lng],[39.6678328,-104.7806396]);
  assert.equal(driveTimeEstimateFor(yale),null);
  assert.ok(driveTimeEstimateFor(halls.find(h=>h.id==='1')));
});

test('inspection resolves the full address for every built-in Hall and added locations', () => {
  for (const location of [...halls, westminster]) {
    const url = new URL(context.inspectionUrl(location));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/search/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('query'), location.address);
    assert.equal(url.searchParams.has('viewpoint'), false);
  }
  assert.equal(new URL(context.inspectionUrl(halls.find(h=>h.id==='19'))).searchParams.get('query'), '17701 E Yale Ave, Aurora CO 80013');
});

test('address corrections and special characters survive without stale coordinates taking precedence', () => {
  const location={...westminster,address:'  100 A&B Lane #2, Aurora, CO 80013  '};
  const url=new URL(context.inspectionUrl(location));
  assert.equal(url.searchParams.get('query'),'100 A&B Lane #2, Aurora, CO 80013');
  assert.equal(url.hash,'');
  assert.equal([...url.searchParams].length,2);
});

test('direct imagery remains available and coordinate-only records explain the fallback', () => {
  const markup=context.inspectionCard(westminster);
  assert.ok(markup.includes(context.inspectionUrl(westminster)));
  assert.ok(markup.includes(context.streetViewUrl(westminster)));
  assert.match(markup,/Street View near map pin/);
  assert.match(markup,/different street number or property/);
  for(const address of ['', '   ', null, undefined]){
    const location={...westminster,address};
    const url=new URL(context.inspectionUrl(location));
    assert.equal(url.searchParams.get('map_action'),'pano');
    assert.equal(url.searchParams.get('viewpoint'),'39.906674,-105.052898');
    assert.match(context.inspectionCard(location),/No street address is saved/);
  }
});

test('administrator inspection uses the currently selected address after changing locations', () => {
  let click;
  const opened=[];
  context.document={addEventListener:(event,handler)=>{assert.equal(event,'click');click=handler;}};
  context.window={open:(...args)=>opened.push(args)};
  context.findLocation=id=>context.locations.find(location=>location.id===id);
  const listener=source.split('\n').find(line=>line.startsWith("document.addEventListener('click',event=>{if(event.target.id==='openStreetFromForm')"));
  assert.ok(listener);
  vm.runInContext(listener,context);
  click({target:{id:'openStreetFromForm'}});
  assert.equal(new URL(opened[0][0]).searchParams.get('query'),'17701 E Yale Ave, Aurora CO 80013');
  context.selectedId='custom';
  click({target:{id:'openStreetFromForm'}});
  assert.equal(new URL(opened[1][0]).searchParams.get('query'),westminster.address);
  assert.deepEqual(opened[1].slice(1),['_blank','noopener']);
  context.selectedId='missing';
  click({target:{id:'openStreetFromForm'}});
  click({target:{id:'saveReview'}});
  assert.equal(opened.length,2);
});
