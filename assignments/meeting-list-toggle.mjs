export function mountMeetingListToggle(button,content,{storage,key='denver2027.assignments.meeting-list',expandedLabel='Minimize list',collapsedLabel='Expand list'}={}){
 let expanded=true;
 try{storage??=globalThis.localStorage;expanded=storage?.getItem(key)!=='collapsed';}catch{}
 function render(){content.hidden=!expanded;button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?expandedLabel:collapsedLabel;}
 button.addEventListener('click',()=>{expanded=!expanded;render();try{storage?.setItem(key,expanded?'expanded':'collapsed');}catch{}});
 render();
}
export function mountMeetingRailFilter(checkbox,details,renderList,{storage}={}){
 const key='denver2027.assignments.meeting-list-rail';
 try{storage??=globalThis.localStorage;checkbox.checked=storage?.getItem(key)!=='hidden';}catch{}
 function render(){details.hidden=!checkbox.checked;renderList();}
 checkbox.addEventListener('change',()=>{try{storage?.setItem(key,checkbox.checked?'shown':'hidden');}catch{}render();});
 render();
}
