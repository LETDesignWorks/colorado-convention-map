import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildTravelSchedule, denverInput, parseDenver, formatDenver, validPoint, safeWebUrl, parkingAdvice, TICKETS} from '../routes/travel-plan.mjs';
import {RTD_STATIONS} from '../routes/stations.js';

test('departure subtracts driving, traffic, station preparation and group reporting separately',()=>{
  const p=buildTravelSchedule({meetingLocal:'2027-07-09T09:00',baseMinutes:22.2,travelAllowance:10,arrivalBuffer:20,boardingBuffer:15,reminderLeadMinutes:30});
  assert.equal(p.plannedTravel,33);
  assert.equal(denverInput(p.arrival),'2027-07-09T08:40');
  assert.equal(denverInput(p.departure),'2027-07-09T08:07');
  assert.equal(denverInput(p.report),'2027-07-09T07:52');
  assert.equal(denverInput(p.reminder),'2027-07-09T07:22');
  assert.equal(p.totalLead,68);
});
test('early meetings produce previous-day departure and reminder dates',()=>{
  const p=buildTravelSchedule({meetingLocal:'2027-07-09T00:20',baseMinutes:30,travelAllowance:15,arrivalBuffer:20,boardingBuffer:15,reminderLeadMinutes:30});
  assert.equal(denverInput(p.departure),'2027-07-08T23:15');
  assert.equal(denverInput(p.reminder),'2027-07-08T22:30');
});
test('Denver parsing is independent of the device timezone and handles daylight saving',()=>{
  assert.equal(parseDenver('2027-01-10T09:00').toISOString(),'2027-01-10T16:00:00.000Z');
  assert.equal(parseDenver('2027-07-10T09:00').toISOString(),'2027-07-10T15:00:00.000Z');
  assert.throws(()=>parseDenver('2027-03-14T02:30'),/does not exist/);
  assert.throws(()=>parseDenver('2027-02-30T09:00'),/does not exist/);
  assert.equal(parseDenver('2027-11-07T01:30').toISOString(),'2027-11-07T07:30:00.000Z');
  const p=buildTravelSchedule({meetingLocal:'2027-03-14T03:15',baseMinutes:30,travelAllowance:0,arrivalBuffer:0,boardingBuffer:0});
  assert.equal(denverInput(p.departure),'2027-03-14T01:45');
  assert.match(formatDenver('2027-07-10T09:00'),/9:00/);
});
test('bad coordinates, unsafe links and negative times cannot form valid plans',()=>{
  for(const point of [['',''],[' ','-104'],[null,null],[91,-104],[39,-181],['bad',0]])assert.equal(validPoint(...point),false);
  assert.equal(validPoint(39.6,-104.8),true);
  assert.equal(safeWebUrl('javascript:alert(1)'),'');
  assert.equal(safeWebUrl('https://www.rtd-denver.com/'),'https://www.rtd-denver.com/');
  assert.throws(()=>buildTravelSchedule({meetingLocal:'2027-07-09T09:00',baseMinutes:10,travelAllowance:-1}));
});
test('station catalog has verified points, sources and honest parking guidance',()=>{
  assert.equal(RTD_STATIONS.length,11);
  assert.equal(new Set(RTD_STATIONS.map(s=>s.id)).size,11);
  for(const station of RTD_STATIONS){assert.ok(validPoint(station.lat,station.lng));assert.match(station.sourceUrl,/^https:\/\/app.rtd-denver.com\/facilities\//);assert.match(station.mapsUrl,/!3d/);}
  assert.match(parkingAdvice(RTD_STATIONS.find(s=>s.id==='rtd-sky-ridge')),/no parking/);
  assert.match(parkingAdvice(RTD_STATIONS.find(s=>s.id==='rtd-orchard')),/small lot/);
  assert.match(parkingAdvice({}),/not been verified/);
  assert.equal(Object.keys(TICKETS).length,4);
});
test('saved RTD plans retain station, ticket choice, notes, reminders and Denver dates',()=>{
  const source=fs.readFileSync('routes/app.js','utf8');
  const ctx=vm.createContext({localInputValue:denverInput,markerLabel:s=>s.markerLabel,currentUser:{email:'planner@example.com'},serverTimestamp:()=>123});
  vm.runInContext(source.slice(source.indexOf('function serializeRoute('),source.indexOf('async function saveRoute(')),ctx);
  const station=RTD_STATIONS.find(s=>s.id==='rtd-nine-mile');
  const route={routeName:'Yale to Nine Mile',tripPurpose:'rtd',origin:{id:'location:19',name:'Yale Hall',address:'17701 E Yale Ave, Aurora CO 80013',lat:39.6678328,lng:-104.7806396},destination:station,distanceMiles:5.444,baseMinutes:12,...buildTravelSchedule({meetingLocal:'2027-07-09T09:00',baseMinutes:12}),parkingNotes:'Meet by the signed pedestrian path',ticketMethod:'machine',extraReminders:'Charge phone\nBring water',notes:'Carpool together'};
  const saved=ctx.serializeRoute(route);
  assert.equal(saved.tripPurpose,'rtd');assert.equal(saved.stationSnapshot.id,station.id);assert.equal(saved.ticketMethod,'machine');assert.equal(saved.hotelId,'location:19');assert.equal(saved.meetingLocal,'2027-07-09T09:00');assert.equal(saved.extraReminders,route.extraReminders);assert.equal(saved.parkingNotes,route.parkingNotes);assert.equal(saved.reminderLeadMinutes,30);assert.equal(saved.timeZone,'America/Denver');
});

test('loading an RTD plan restores its settings and uses the corrected starting-location pin',async()=>{
  const source=fs.readFileSync('routes/app.js','utf8');
  const station=RTD_STATIONS[10];
  const saved={id:'plan-1',routeName:'Saved connection',tripPurpose:'rtd',hotelId:'location:19',origin:{lat:0,lng:0},destinationId:station.id,stationSnapshot:station,meetingLocal:'2027-07-09T09:00',ticketMethod:'contactless',parkingNotes:'Meet at entrance',extraReminders:'Bring water',reminderLeadMinutes:45,travelAllowance:10,arrivalBuffer:20,boardingBuffer:5};
  const els=Object.fromEntries(['tripPurpose','routeName','routeNotes','meetingAt','travelAllowance','arrivalBuffer','boardingBuffer','hotelSelect','customOriginWrap','destinationSelect','parkingNotes','ticketMethod','extraReminders','reminderLeadMinutes'].map(id=>[id,{value:''}]));
  const currentOrigin={id:'location:19',name:'Yale',lat:39.6678328,lng:-104.7806396};
  const ctx=vm.createContext({savedRoutes:[saved],locations:[station],els,originLocations:()=>[currentOrigin],handlePurposeChange(){},selectDestination(id){assert.equal(id,station.id);},geocodeCache:{},saveCache(){},handleHotelChange(){},async calculateRoute(){assert.equal(els.tripPurpose.value,'rtd');},toast(){},window:{scrollTo(){}},currentRouteId:null});
  vm.runInContext(source.slice(source.indexOf('async function loadSavedRoute('),source.indexOf('async function deleteSavedRoute(')),ctx);
  await ctx.loadSavedRoute('plan-1');
  assert.equal(els.ticketMethod.value,'contactless');assert.equal(els.extraReminders.value,'Bring water');assert.equal(els.reminderLeadMinutes.value,45);assert.equal(els.arrivalBuffer.value,20);assert.equal(els.hotelSelect.value,'location:19');
  // geocodeOrigin intentionally bypasses old cached coordinates for saved map locations.
  const originCode=source.slice(source.indexOf('async function geocodeOrigin('),source.indexOf('function resolveDestination('));
  vm.runInContext(originCode,ctx);
  const actual=await ctx.geocodeOrigin();assert.equal(actual.lat,currentOrigin.lat);assert.equal(actual.lng,currentOrigin.lng);
});
