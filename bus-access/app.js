await import('../assets/location-address-autofill.js?v=20260910-3');

const enhancementStyles=document.createElement('link');
enhancementStyles.rel='stylesheet';
enhancementStyles.href='enhancements.css';
document.head.appendChild(enhancementStyles);
const routeLink=document.createElement('a');
routeLink.className='btn primary';
routeLink.href='../routes/?mode=rtd';
routeLink.textContent='Bus & RTD Plans';
routeLink.setAttribute('aria-label','Open bus and RTD station departure planner');
const headerActions=document.querySelector('.header-actions');
const addButton=document.getElementById('addLocationButton');
if(headerActions){headerActions.insertBefore(routeLink,addButton||document.getElementById('loginButton'));const rushLink=document.createElement('a');rushLink.className='btn secondary';rushLink.href='../rush-hour/';rushLink.textContent='Rush-hour Routes';headerActions.insertBefore(rushLink,addButton||document.getElementById('loginButton'));}
import('./app-v2.js?v=foxfield-congregations-20261111-1');

