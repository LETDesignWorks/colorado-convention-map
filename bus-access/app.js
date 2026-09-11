await import('../assets/location-address-autofill.js?v=20260910-3');

const enhancementStyles=document.createElement('link');
enhancementStyles.rel='stylesheet';
enhancementStyles.href='enhancements.css';
document.head.appendChild(enhancementStyles);
const routeLink=document.createElement('a');
routeLink.className='btn primary';
routeLink.href='../routes/';
routeLink.textContent='Route Planner';
routeLink.setAttribute('aria-label','Open hotel-to-field-service bus route planner');
const headerActions=document.querySelector('.header-actions');
const addButton=document.getElementById('addLocationButton');
if(headerActions)headerActions.insertBefore(routeLink,addButton||document.getElementById('loginButton'));
import('./app-v2.js');
