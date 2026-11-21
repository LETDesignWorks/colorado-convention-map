import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {getFirestore,doc,getDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {validate} from './model.mjs';
const OWNER='jPTl6zfkjaTbbCJMI7A7xXE2BN93';
const app=getApps().find(a=>a.name==='[DEFAULT]')||initializeApp({apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'});
const auth=getAuth(app),db=getFirestore(app);
const reference=id=>doc(db,'reviews','field-service-load-test-v2-'+id);
function requireOwner(){if(auth.currentUser?.uid!==OWNER)throw Error('Use the convention planning administrator account to save or load this private tracker.');}
export const observe=fn=>onAuthStateChanged(auth,u=>fn(u?.uid===OWNER?u:null));
export async function login(email,password){await signInWithEmailAndPassword(auth,email,password);if(auth.currentUser.uid!==OWNER){await signOut(auth);throw Error('This account does not have access to the private load-test tracker.');}}
export const logout=()=>signOut(auth);
export async function load(id){requireOwner();const snap=await getDoc(reference(id));if(!snap.exists())return null;const data=snap.data();if(data.recordType!=='field-service-load-test-v2')throw Error('The saved record has an unexpected format.');return {plan:validate(JSON.parse(data.planJson)),revision:data.revision||0};}
export async function save(plan,expectedRevision){requireOwner();validate(plan);return runTransaction(db,async tx=>{const ref=reference(plan.id),snap=await tx.get(ref),current=snap.exists()?(snap.data().revision||0):0;if(snap.exists()&&expectedRevision===null)throw Error('A website copy already exists. Download a backup of your draft, then load the website copy before making changes.');if(expectedRevision!==null&&current!==expectedRevision)throw Error('The website copy changed since you loaded it. Download a backup, then load the latest website copy to avoid replacing newer work.');const revision=current+1;tx.set(ref,{recordType:'field-service-load-test-v2',planJson:JSON.stringify(plan),revision,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});return revision;});}
