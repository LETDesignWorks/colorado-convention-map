import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pages=['travel-routes/index.html','index.html','activities/index.html','activity-planning/index.html','assignments/index.html','bus-access/index.html','full-map.html','map-fullscreen.html','load-tests/index.html','operating-plan/index.html','pdf-tools/index.html','route-planner/index.html','routes/index.html','rush-hour/index.html','smpw/index.html','south-dtc-rail/index.html','team/index.html','team/johnathan.html','team/michael.html','team/seth.html','territories/coffee-data-sources.html'];
const moduleSource='const PDF_BUILDER_URL="https://letdesignworks.github.io/colorado-convention-map/pdf-tools/"; const openPdfBuilderWindow=()=>{};\n'+read('assets/site-navigation.mjs').replace(/^import [^\r\n]*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify('https://letdesignworks.github.io/colorado-convention-map/assets/site-navigation.mjs')).replace(/export /g,'').replace(/if \(document.readyState === 'loading'\)[\s\S]*$/,'mountSiteNavigation();');
for(const page of pages)test('all tabs are present once on '+page,()=>{
 assert.match(read(page),/site-navigation\.mjs/);
 const dom=new JSDOM(read(page),{url:'https://letdesignworks.github.io/colorado-convention-map/'+page,runScripts:'outside-only'});
 const context=dom.getInternalVMContext();vm.runInContext(moduleSource,context);vm.runInContext('mountSiteNavigation()',context);
 const tabs=[...dom.window.document.querySelectorAll('[data-site-tab]')];
 assert.equal(tabs.length,12);assert.equal(new Set(tabs.map(a=>a.href)).size,12);
 assert(tabs.every(a=>!a.hidden));assert(!tabs.some(a=>/load-tests/.test(a.href)));
 assert.equal(dom.window.document.querySelectorAll('.convention-navigation').length,1);
 assert(tabs.some(a=>a.textContent==='Travel Routes'));assert(![...dom.window.document.querySelectorAll('.convention-navigation a')].some(a=>/Field Service Routes|Rush-hour Routes|Operating Plan|Delegate Activities/.test(a.textContent)));
 dom.window.close();
});
test('territory template navigation is mounted after the asynchronous body replacement',()=>{
 const dom=new JSDOM('<body>Loading…</body>',{url:'https://letdesignworks.github.io/colorado-convention-map/territories/',runScripts:'outside-only'});
 const context=dom.getInternalVMContext();vm.runInContext(moduleSource,context);
 dom.window.document.body.innerHTML=read('territories/template.html');vm.runInContext('mountSiteNavigation()',context);
 assert.equal(dom.window.document.querySelectorAll('[data-site-tab]').length,12);
 assert.match(read('assets/branding.js'),/mountSiteNavigation\(\)/);
 assert.match(read('territories/bootstrap.js'),/app-main\.js\?v=[a-z0-9-]+/);
 dom.window.close();
});
test('selected meeting context and page-specific controls survive navigation updates',()=>{
 const dom=new JSDOM('<header><nav class="actions"><a href="../activity-planning/?hall=14">Activity Planning</a><button id="signOut">Sign out</button></nav></header>',{url:'https://letdesignworks.github.io/colorado-convention-map/territories/',runScripts:'outside-only'});
 const context=dom.getInternalVMContext();vm.runInContext(moduleSource,context);vm.runInContext('mountSiteNavigation()',context);
 assert.equal(new URL(dom.window.document.querySelector('[data-site-tab="activity-planning/"]').href).searchParams.get('hall'),'14');
 assert.equal(dom.window.document.querySelectorAll('#signOut').length,1);
 dom.window.close();
});
