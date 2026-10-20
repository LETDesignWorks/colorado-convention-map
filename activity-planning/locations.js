import { ACTIVITY_POINTS } from '../activities/data.js';
import { HOTELS } from '../routes/hotels.js';
import { HALLS } from '../territories/halls.js';
export const LOCATIONS=[
  {id:'ccc',name:'Colorado Convention Center',address:'700 14th St, Denver, CO 80202',lat:39.74248,lng:-104.99567,group:'Rally points',note:'Rally point. Confirm the assigned bus-loading curb.'},
  ...ACTIVITY_POINTS.map(p=>({...p,group:'Activities'})),
  {id:'cabin-creek',name:'Cabin Creek Brewing · Georgetown Lake',address:'577 22nd St, Georgetown, CO 80444',group:'Activities',note:'Brewery by Georgetown Lake. Confirm motorcoach access and loading with the venue.',source:'https://www.cabincreekbrewing.com/contact'},
  ...HOTELS.map(p=>({...p,id:'hotel-'+p.id,name:p.id+' · '+p.name,group:'Delegate hotels'})),
  ...HALLS.map(p=>({...p,id:'hall-'+p.id,hallId:String(p.id),group:'Field service / meeting places',name:p.number+' · '+p.name}))
];
// Use the published parking entrance for Four Mile rather than the historic house.
const fourMile=LOCATIONS.find(p=>p.id==='four-mile-historic-park');
Object.assign(fourMile,{address:'4846 E Exposition Ave, Glendale, CO',lat:null,lng:null,note:'Park parking entrance on E. Exposition Ave. Confirm the final coach loading area.',source:'https://www.fourmilepark.org/plan-your-visit/map-directions/'});
export const SOURCES=[['Four Mile parking / drop-off','https://www.fourmilepark.org/plan-your-visit/map-directions/'],['Georgetown rail depot','https://www.georgetownlooprr.com/faqs-directions/'],['Cabin Creek Brewing','https://www.cabincreekbrewing.com/contact']];
