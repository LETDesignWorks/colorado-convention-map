import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAssignmentReport} from '../assignments/report-ui.mjs';
import {buildAssignmentReport,DELEGATE_SETTING_KEY} from '../assignments/report-model.mjs';

function fixture(){
  const dom=new JSDOM('<section id="report"></section>',{url:'https://example.test/assignments/'});
  const root=dom.window.document.getElementById('report'),storage=dom.window.localStorage;
  const changes=[],validity=[];
  const ui=createAssignmentReport(root,{storage,onChange:value=>changes.push(value),onValidityChange:value=>validity.push(value)});
  const input=root.querySelector('input');
  const set=value=>{input.value=String(value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  return {dom,root,storage,changes,validity,ui,input,set};
}
const report=(overrides={})=>buildAssignmentReport({
  congregations:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Gamma'},{id:'d',name:'Delta'}],
  assignmentFor:id=>['a','b','d'].includes(id)?{meetingPointId:'meeting'}:null,
  serviceDaysFor:id=>['a','b','c'].includes(id)?['Monday','Tuesday']:[],sharedReady:true,...overrides
});

test('report panel shows full assignment progress and distinct scheduled/delegate counts',()=>{
  const f=fixture();f.ui.update(report());
  assert.match(f.root.querySelector('[data-report-count]').textContent,/3of 4 congregations assigned/);
  const progress=f.root.querySelector('[role="progressbar"]');
  assert.equal(progress.getAttribute('aria-valuenow'),'3');assert.equal(progress.getAttribute('aria-valuemax'),'4');
  assert.equal(progress.firstElementChild.style.width,'75%');
  const day=f.root.querySelector('[data-report-days] tr');
  assert.deepEqual([...day.children].map(cell=>cell.textContent),['Monday','3','2','1','100']);
  assert.match(f.root.querySelector('[data-congregation-bars] [role="img"]').getAttribute('aria-label'),/Monday: 3 scheduled congregations, 2 with meeting locations/);
  assert.match(f.root.querySelector('[data-delegate-bars] [role="img"]').getAttribute('aria-label'),/Monday: 100 estimated delegates/);
  assert.match(f.root.querySelector('[data-report-missing]').textContent,/1 assigned congregation still needs a service day/);
  f.dom.window.close();
});

test('delegate edits persist and update formulas while invalid values block export without replacing the last valid estimate',()=>{
  const f=fixture();f.set(65);f.ui.update(report({delegatesPerCongregation:f.ui.getValue()}));
  assert.equal(f.storage.getItem(DELEGATE_SETTING_KEY),'65');assert.equal(f.ui.validatedValue(),65);assert.equal(f.ui.valid(),true);
  assert.match(f.root.querySelector('[data-report-formula]').textContent,/× 65 delegates/);
  assert.equal(f.root.querySelector('[data-report-days] tr').lastElementChild.textContent,'130');
  f.set(-1);assert.equal(f.ui.valid(),false);assert.equal(f.ui.getValue(),65);assert.throws(()=>f.ui.validatedValue());
  assert.equal(f.root.querySelector('#delegateSettingError').hidden,false);assert.equal(f.input.getAttribute('aria-invalid'),'true');
  f.set(0);assert.equal(f.ui.valid(),true);assert.equal(f.ui.validatedValue(),0);assert.equal(f.storage.getItem(DELEGATE_SETTING_KEY),'0');
  assert.equal(f.root.querySelector('#delegateSettingError').hidden,true);assert.deepEqual(f.validity,[true,false,true]);
  f.ui.update(report({delegatesPerCongregation:f.ui.getValue()}));
  assert.equal(f.root.querySelector('[data-report-days] tr').lastElementChild.textContent,'0');
  f.dom.window.close();
});

test('cold data does not display invented zero counts and cached totals remain visibly qualified',()=>{
  const f=fixture();f.ui.update(report(),{available:false});
  assert.equal(f.root.querySelector('[data-report-results]').hidden,true);
  assert.match(f.root.querySelector('[data-report-status]').textContent,/Loading saved assignments/);
  f.ui.update(report({sharedReady:false}));
  assert.equal(f.root.querySelector('[data-report-results]').hidden,false);
  assert.match(f.root.querySelector('[data-report-status]').textContent,/cached shared data/);
  f.ui.update(report());assert.doesNotMatch(f.root.querySelector('[data-report-status]').textContent,/cached/);
  assert.equal(f.root.querySelector('[data-report-status]').classList.contains('report-cached'),false);
  f.dom.window.close();
});

test('incoming reports preserve input focus, draft validation, and the chosen collapse state',()=>{
  const f=fixture();f.root.querySelector('details').open=false;f.input.focus();f.set('');
  f.ui.update(report());
  assert.equal(f.dom.window.document.activeElement,f.input);assert.equal(f.input.value,'');
  assert.equal(f.ui.valid(),false);assert.equal(f.root.querySelector('details').open,false);
  assert.equal(f.root.querySelector('#delegateSettingError').hidden,false);
  f.dom.window.close();
});
