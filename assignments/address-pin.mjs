import {addressKey,validPoint,distanceMiles,findAddress} from './location-model.mjs?v=address-help-20261114-1';

const aliases={colorado:'co',wyoming:'wy',nebraska:'ne','south dakota':'sd',kansas:'ks','new mexico':'nm',utah:'ut',arizona:'az',montana:'mt',oklahoma:'ok',texas:'tx',california:'ca',parkway:'pkwy',lane:'ln',place:'pl',terrace:'ter',highway:'hwy'};
function normalized(value){
  return addressKey(value).replace(/\b(united states(?: of america)?|usa|us)\s*$/,'').replace(/\b(colorado|wyoming|nebraska|south dakota|kansas|new mexico|utah|arizona|montana|oklahoma|texas|california|parkway|lane|place|terrace|highway)\b/g,s=>aliases[s]).replace(/\b(\d{5})-\d{4}\b/g,'$1').trim();
}
export function matchingAddressPin(query,candidates){
  const wanted=normalized(query),hasZip=/\b\d{5}$/.test(wanted);
  if(!/^\d+[a-z]?\s/.test(wanted))return null;
  const matches=candidates.filter(p=>{
    if(p.approximate||!validPoint(p.lat,p.lng))return false;
    let address=normalized(p.address);
    if(!hasZip)address=address.replace(/\s\d{5}$/,'');
    return wanted===address;
  });
  if(!matches.length)return null;
  // Duplicate building/entrance results are equivalent only when they agree spatially.
  if(matches.some(p=>distanceMiles(matches[0],p)>.03))return null;
  return matches[0];
}
export async function resolveAddressPin(query,knownPoints=[],{signal,lookup=findAddress}={}){
  const known=matchingAddressPin(query,knownPoints);
  if(known)return {pin:known,candidates:[],source:'Existing hall address pin'};
  const candidates=await lookup(query,{signal});
  return {pin:matchingAddressPin(query,candidates),candidates,source:'Automatic address lookup (Photon / OpenStreetMap)'};
}
