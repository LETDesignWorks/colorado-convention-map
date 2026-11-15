const SESSION_KEY='denver-rush-hour-tomtom-session';
const DEVICE_KEY='denver2027.travel.tomtom-key';
const read=(storage,key)=>{try{return storage?.getItem(key)||'';}catch{return '';}};
const write=(storage,key,value)=>{try{if(!storage)return false;if(value)storage.setItem(key,value);else storage.removeItem(key);return true;}catch{return false;}};
export function createRoutingKeyStore({session,device}={}){
 return {
  read(){const remembered=read(device,DEVICE_KEY);return {key:remembered||read(session,SESSION_KEY),remember:!!remembered};},
  save(key,remember=false){
   key=String(key||'').trim();
   const sessionSaved=write(session,SESSION_KEY,key);
   const deviceSaved=write(device,DEVICE_KEY,remember?key:'');
   return {sessionSaved,deviceSaved,remembered:!!key&&remember&&deviceSaved};
  },
  clear(){return {sessionCleared:write(session,SESSION_KEY,''),deviceCleared:write(device,DEVICE_KEY,'')};}
 };
}

