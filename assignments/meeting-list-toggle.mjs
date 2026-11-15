export function mountMeetingListToggle(button,content,{storage=globalThis.localStorage}={}){
 const key='denver2027.assignments.meeting-list';let expanded=true;
 try{expanded=storage.getItem(key)!=='collapsed';}catch{}
 function render(){content.hidden=!expanded;button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Minimize list':'Expand list';}
 button.addEventListener('click',()=>{expanded=!expanded;render();try{storage.setItem(key,expanded?'expanded':'collapsed');}catch{}});
 render();
}
