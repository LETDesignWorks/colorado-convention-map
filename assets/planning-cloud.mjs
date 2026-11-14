import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {getAuth} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {getFirestore,collection,query,where,onSnapshot,doc,setDoc,deleteDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {observeSiteAccess,canView,canEdit} from './site-access.mjs?v=access-20261114-1';
const config={apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'};
const app=getApps().length?getApp():initializeApp(config);
export const db=getFirestore(app),auth=getAuth(app);
export {canView,canEdit,observeSiteAccess};
export function watchHalls(callback,error){return onSnapshot(collection(db,'halls'),s=>callback(s.docs.map(d=>({...d.data(),id:d.id}))),error);}
export function watchRecords(type,callback,error){return onSnapshot(query(collection(db,'reviews'),where('recordType','==',type)),s=>callback(s.docs.map(d=>({...d.data(),id:d.id}))),error);}
export async function saveRoute(payload,id){
 if(!canEdit('routes'))throw Error('Sign in with Travel Routes edit access to save.');
 const ref=id?doc(db,'reviews',id):doc(collection(db,'reviews'));
 await setDoc(ref,{...payload,updatedByEmail:auth.currentUser?.email||'',updatedAt:serverTimestamp()}, {merge:true});return ref.id;
}
export async function removeRoute(id){if(!canEdit('routes'))throw Error('Travel Routes edit access is required.');await deleteDoc(doc(db,'reviews',id));}

