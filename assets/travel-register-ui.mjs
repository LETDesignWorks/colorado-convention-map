import {travelEntries,filterTravelEntries,locationKey} from './travel-register.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createTravelRegister(element){
  let records=[],locations=[],congregations=[],access=false,filters={date:'',hotel:'',meeting:'',congregation:'',text:''};
  const options=(items,key)=>'<option value="">All</option>'+items.map(p=>'<option value="'+esc(p.id)+'"'+(filters[key]===String(p.id)?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  function render(){
    const entries=filterTravelEntries(travelEntries(records,locations),filters);
    element.innerHTML='<h2>Travel route register</h2><p class="hint">Each saved trip is a separate assignment. A hotel or congregation may use several routes on the same day.</p>'+
      (access?'<div class="register-filters"><label>Date · Denver<input type="date" data-filter="date" value="'+esc(filters.date)+'"></label><label>Hotel<select data-filter="hotel">'+options(locations.filter(p=>p.group==='Hotels'),'hotel')+'</select></label><label>Meeting point<select data-filter="meeting">'+options(locations.filter(p=>p.group==='Field service / meeting places').map(p=>({...p,id:locationKey(p.id)})),'meeting')+'</select></label><label>Congregation<select data-filter="congregation">'+options(congregations,'congregation')+'</select></label></div><p class="hint">'+entries.length+' matching route'+(entries.length===1?'':'s')+'</p><div class="register-rows">'+entries.map(e=>{
        const names=(ids,all)=>ids.map(id=>all.find(p=>String(p.id)===id)?.name||id).join(', ');
        return '<article class="register-route"><strong>'+esc(e.name)+'</strong><span class="route-state">'+esc(e.status)+(e.draft?' · schedule draft':'')+'</span><p>'+esc(e.dates.join(', ')||'Date needed')+' · '+esc(e.modes.join(' / '))+(e.vehicle?' · '+esc(e.vehicle):'')+'</p><p>'+esc(e.stops.map(p=>p.name||'Location').join(' → '))+'</p>'+(e.hotelIds.length?'<small>Hotels: '+esc(names(e.hotelIds,locations))+'</small>':'')+(e.congregationIds.length?'<small>Congregations: '+esc(names(e.congregationIds,congregations))+'</small>':'')+(e.passengers?'<small>Planned passengers: '+e.passengers+'</small>':'')+'<a href="'+new URL('../travel-routes/?route='+encodeURIComponent(e.id),import.meta.url).href+'">Open route</a></article>';
      }).join('')+'</div>':'<p class="hint">Sign in with Travel Routes viewing access to see the route register.</p>');
  }
  element.addEventListener('change',event=>{const key=event.target.dataset.filter;if(key){filters[key]=event.target.value;render();}});
  return {update(data){({records=records,locations=locations,congregations=congregations,access=access}=data);render();},meeting(id){filters.meeting=locationKey(id);render();},render};
}
