const enhancementStyles=document.createElement('link');
enhancementStyles.rel='stylesheet';
enhancementStyles.href='enhancements.css';
document.head.appendChild(enhancementStyles);

const headerActions=document.querySelector('.header-actions');
if(headerActions&&!document.getElementById('routePlannerNav')){
  const link=document.createElement('a');
  link.id='routePlannerNav';
  link.className='btn primary';
  link.href='../route-planner/';
  link.textContent='Route Planner';
  link.addEventListener('click',()=>{
    const match=location.hash.match(/location-([^&]+)/);
    link.href=match?`../route-planner/?destination=${encodeURIComponent(decodeURIComponent(match[1]))}`:'../route-planner/';
  });
  const addButton=document.getElementById('addLocationButton');
  headerActions.insertBefore(link,addButton||document.getElementById('loginButton'));
}
import('./app-v2.js');
