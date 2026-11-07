import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficBasemap} from '../bus-access/traffic-basemap.mjs';

// Exercise layer lifecycles and late network events without fetching map tiles.
// This stub tracks both attached groups and their children like Leaflet does.
function harness() {
  class Layer {
    constructor(url,options={}) {this.url=url;this.options=options;this.events=new Map();}
    addTo(target) {target.addLayer(this);return this;}
    remove() {this._map?.removeLayer(this);return this;}
    on(type,callback) {if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(callback);return this;}
    fire(type) {for(const callback of this.events.get(type)||[])callback({type,target:this});return this;}
  }
  class Group extends Layer {
    constructor(layers=[]) {super();this.children=new Set(layers);}
    addLayer(layer) {this.children.add(layer);this._map?.addLayer(layer);return this;}
  }
  const map={
    layers:new Set(),
    addLayer(layer) {this.layers.add(layer);layer._map=this;if(layer instanceof Group)for(const child of layer.children)this.addLayer(child);return this;},
    removeLayer(layer) {if(layer instanceof Group)for(const child of layer.children)this.removeLayer(child);this.layers.delete(layer);layer._map=null;return this;},
    hasLayer(layer) {return this.layers.has(layer);}
  };
  const L={tileLayer:(url,options)=>new Layer(url,options),layerGroup:layers=>new Group(layers)};
  const errors=[],basemap=createTrafficBasemap({L,map,onTileError:value=>errors.push(value)});
  return {map,basemap,errors,tiles:()=>[...map.layers].filter(layer=>!(layer instanceof Group)),groups:()=>[...map.layers].filter(layer=>layer instanceof Group)};
}

test('satellite layers pair imagery with street names below traffic items at every supported zoom',()=>{
  const h=harness();h.basemap.set('satellite');
  const tiles=h.tiles(),imagery=tiles.find(layer=>layer.url.includes('/World_Imagery/')),names=tiles.find(layer=>layer.url.includes('/World_Transportation/'));
  assert.equal(tiles.length,2);assert.equal(h.groups().length,1);
  assert.ok(imagery,'satellite imagery is present');assert.ok(names,'street names are present');
  assert.match(imagery.url,/\/tile\/\{z\}\/\{y\}\/\{x\}$/);assert.match(names.url,/\/tile\/\{z\}\/\{y\}\/\{x\}$/);
  for(const layer of tiles){
    assert.equal(layer.options.pane,'tilePane','background names stay below Leaflet vector and marker panes');
    assert.equal(layer.options.maxNativeZoom,19);assert.equal(layer.options.maxZoom,22);
    assert.ok(layer.options.attribution,'each provider layer retains attribution');
  }
  assert.ok(names.options.zIndex>imagery.options.zIndex,'names are above imagery within the background pane');
  h.basemap.dispose();assert.equal(h.map.layers.size,0);
});

test('switching backgrounds replaces the whole layer group without leftover or duplicate street labels',()=>{
  const h=harness();h.basemap.set('satellite');let previous=h.tiles();
  h.basemap.set('street');
  assert.equal(h.groups().length,1);assert.equal(h.tiles().length,1);
  assert.match(h.tiles()[0].url,/^https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/);
  for(const layer of previous)assert.equal(h.map.hasLayer(layer),false,'both satellite layers are removed');
  previous=h.tiles();h.basemap.set('satellite');
  assert.equal(h.groups().length,1);assert.equal(h.tiles().length,2);
  assert.equal(h.tiles().filter(layer=>layer.url.includes('/World_Transportation/')).length,1);
  for(const layer of previous)assert.equal(h.map.hasLayer(layer),false,'the street background is removed');
  h.basemap.set('satellite');assert.equal(h.groups().length,1);assert.equal(h.tiles().length,2,'repeated saved satellite loads do not accumulate layers');
  h.basemap.dispose();h.basemap.dispose();assert.equal(h.map.layers.size,0);
});

test('tile warnings belong only to the current background and stop after replacement or disposal',()=>{
  const h=harness();h.basemap.set('satellite');
  const old=h.tiles();for(const layer of old){layer.fire('tileerror');layer.fire('tileerror');}
  assert.equal(h.errors.length,0,'isolated tile errors do not repeatedly interrupt the planner');
  h.basemap.set('street');for(const layer of old){layer.fire('tileerror');layer.fire('tileerror');}
  assert.equal(h.errors.length,0,'late errors from removed imagery and labels are ignored');
  const street=h.tiles()[0];street.fire('tileerror');street.fire('tileerror');street.fire('tileerror');street.fire('tileerror');
  assert.equal(h.errors.length,1,'the active layer reports a failure once at the third tile error');
  h.basemap.set('satellite');const current=h.tiles();
  const names=current.find(layer=>layer.url.includes('/World_Transportation/'));
  names.fire('tileerror');names.fire('tileerror');names.fire('tileerror');
  assert.equal(h.errors.length,2,'the active street-name layer can report its own failure');
  h.basemap.dispose();for(const layer of [street,...current])for(let i=0;i<4;i++)layer.fire('tileerror');
  assert.equal(h.errors.length,2,'closed planners never receive stale tile warnings');assert.equal(h.map.layers.size,0);
});
