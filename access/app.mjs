import {initializeApp, getApps, getApp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail, reload} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {getFirestore, collection, query, where, onSnapshot, doc, setDoc, serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {observeSiteAccess, isOwner, checkAccessRules, accessSnapshot} from '../assets/site-access.mjs?v=access-20261114-1';
import {SECTIONS, OWNER_EMAIL, ACCESS_VERSION, policyId, normalizeEmail, cleanPermissions, permission} from '../assets/access-model.mjs?v=access-20261114-1';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const app = getApps().length ? getApp() : initializeApp({apiKey:'AIzaSyCylmVdVwc6tnvF3Tq9M_GE_V8KKGkABog',authDomain:'convention-fs.firebaseapp.com',projectId:'convention-fs',storageBucket:'convention-fs.firebasestorage.app',messagingSenderId:'29365992209',appId:'1:29365992209:web:0bd35e723688b37d776ab0',measurementId:'G-054BLBBE0F'});
const auth = getAuth(app), db = getFirestore(app);
let stopUsers, savedUsers = [], rulesReady = false;
function message(text, error = false) {$('message').textContent = text; $('message').classList.toggle('error', error);}
function editor(record = {}) {
  $('presetStatus').textContent = '';
  $('editorTitle').textContent = record.email ? 'Edit login access' : 'Add a login';
  $('userName').value = record.name || ''; $('userEmail').value = record.email || ''; $('userEmail').readOnly = !!record.email;
  $('userEnabled').checked = record.enabled !== false;
  const levels = cleanPermissions(record.permissions);
  $('permissionRows').innerHTML = SECTIONS.map(section => `<tr><td><strong>${esc(section.label)}</strong><small>${esc(section.description)}</small></td><td><select aria-label="${esc(section.label)} access" data-section="${section.id}">${[['none','Public only'],['view','View'],['edit','View & edit']].map(([value,label]) => `<option value="${value}" ${levels[section.id] === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td></tr>`).join('');
}
async function checkSetup() {
  try { await checkAccessRules(db); rulesReady = true; } catch { rulesReady = false; }
  $('rulesStatus').className = 'notice ' + (rulesReady ? 'ready' : 'pending');
  $('rulesStatus').textContent = rulesReady ? 'Shared permissions are ready. Verified invited logins can use their saved access.' : 'Setup pending: your main account still works. Additional login permissions are saved as drafts until the Firebase rules are published.';
  $('setupHelp').hidden = rulesReady;
  renderUsers();
}
function renderUsers() {
  const search = $('userSearch').value.trim().toLowerCase();
  const visibleUsers = savedUsers.filter(record => `${record.name || ''} ${record.email}`.toLowerCase().includes(search));
  $('userCount').textContent = `${savedUsers.length} configured login${savedUsers.length === 1 ? '' : 's'}${search ? ` · ${visibleUsers.length} matching` : ''} · No fixed user limit. Your main account always retains control.`;
  $('users').innerHTML = visibleUsers.map(record => `<div class="user-card"><div><strong>${esc(record.name)}</strong><span>${esc(record.email)}</span><small>${!record.enabled ? 'Disabled' : rulesReady ? 'Enabled · email verification required' : 'Setup pending'}</small></div><button class="secondary" data-edit="${esc(record.email)}">Edit access</button></div>`).join('') || (search ? '<p>No logins match this search.</p>' : '<p>No additional logins have been configured yet. Add a person above, then repeat for everyone on your planning team.</p>');
  $('users').querySelectorAll('[data-edit]').forEach(button => button.onclick = () => {editor(savedUsers.find(record => record.email === button.dataset.edit)); $('userForm').scrollIntoView({behavior:'smooth',block:'start'});});
}
editor();
await setPersistence(auth, browserLocalPersistence);
observeSiteAccess(auth, user => {
  stopUsers?.(); stopUsers = null; savedUsers = [];
  $('login').hidden = !!user; $('signOut').hidden = !user;
  $('verify').hidden = !user || user.emailVerified || isOwner(user);
  $('ownerPanel').hidden = !isOwner(user);
  $('myPermissions').hidden = !user || isOwner(user);
  $('accountStatus').textContent = user ? `${user.email}${isOwner(user) ? ' · Main account · Full control' : user.emailVerified ? ' · Email verified' : ' · Email verification needed'}` : 'Sign in with your own email and password.';
  if (isOwner(user)) {
    checkSetup();
    stopUsers = onSnapshot(query(collection(db,'reviews'),where('recordType','==','site-user-access')), snapshot => {
      savedUsers = snapshot.docs.map(row => row.data()).sort((a,b) => a.email.localeCompare(b.email)); renderUsers();
    }, error => message('Could not load configured logins: ' + error.message, true));
  } else if (user) {
    const snapshot = accessSnapshot();
    $('myPermissions').innerHTML = '<h3>Your planning access</h3>' + (!snapshot.ready ? '<p>Your permissions are not active yet. Verify your email and ask the main account to check your invitation and shared permission setup.</p>' : '<ul>' + SECTIONS.map(section => `<li>${esc(section.label)}: ${({'none':'Public only','view':'View','edit':'View & edit'})[permission(user,snapshot.policy,section.id,snapshot.ready)]}</li>`).join('') + '</ul>');
  } else $('users').replaceChildren();
});
$('login').onsubmit = async event => {
  event.preventDefault(); $('loginSubmit').disabled = true;
  try {
    const email = normalizeEmail($('email').value), password = $('password').value;
    if ($('createAccount').checked) {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      $('password').value = '';
      try {await sendEmailVerification(result.user); message('Login created. Check your email for the verification link, then return here.');}
      catch {message('Login created. Use Send verification email to finish setup.', true);}
    } else {await signInWithEmailAndPassword(auth,email,password); $('password').value=''; message('Signed in.');}
  } catch (error) {message(error.code === 'auth/email-already-in-use' ? 'This email already has a login. Uncheck Create my invited login, then sign in or reset its password.' : 'Could not sign in or create the login: ' + error.message, true);}
  finally {$('loginSubmit').disabled = false;}
};
$('createAccount').onchange = () => {$('loginSubmit').textContent = $('createAccount').checked ? 'Create login & send verification' : 'Sign in'; $('password').autocomplete = $('createAccount').checked ? 'new-password' : 'current-password';};
$('signOut').onclick = () => signOut(auth).catch(error => message(error.message,true));
$('resetPassword').onclick = async () => {try {const email=normalizeEmail($('email').value); policyId(email); await sendPasswordResetEmail(auth,email); message('If this email has a login, a reset link has been requested. Check its inbox.');} catch(error){message(error.message,true);}};
$('sendVerification').onclick = async () => {try {await sendEmailVerification(auth.currentUser); message('Verification email sent.');}catch(error){message(error.message,true);}};
$('refreshVerification').onclick = async () => {try {await reload(auth.currentUser); await auth.currentUser.getIdToken(true); message(auth.currentUser.emailVerified ? 'Email verified. Your permissions are refreshing.' : 'Email is not verified yet. Use the link in your verification email.');}catch(error){message(error.message,true);}};
$('checkRules').onclick = checkSetup;
$('newUser').onclick = () => editor();
$('userSearch').addEventListener('input', renderUsers);
document.querySelectorAll('[data-access-preset]').forEach(button => button.addEventListener('click', () => {
  if (!isOwner(auth.currentUser)) return;
  const level = button.dataset.accessPreset;
  if (!['none','view','edit'].includes(level)) return;
  document.querySelectorAll('[data-section]').forEach(select => {select.value = level;});
  $('presetStatus').textContent = `${{'none':'Public only','view':'View','edit':'View & edit'}[level]} selected for all sections below. Adjust any individual section, then save to apply.`;
}));
$('userForm').onsubmit = async event => {
  event.preventDefault(); if (!isOwner(auth.currentUser)) return;
  const email = normalizeEmail($('userEmail').value);
  if (email === OWNER_EMAIL) {message('Your main account is protected and always retains full control.',true);return;}
  $('saveUser').disabled = true;
  try {
    const permissions = cleanPermissions(Object.fromEntries([...document.querySelectorAll('[data-section]')].map(select => [select.dataset.section,select.value])));
    await setDoc(doc(db,'reviews',policyId(email)), {recordType:'site-user-access',schemaVersion:ACCESS_VERSION,email,name:$('userName').value.trim(),enabled:$('userEnabled').checked,permissions,updatedAt:serverTimestamp(),updatedByUid:auth.currentUser.uid});
    message(rulesReady ? 'Access saved. The person can create or sign in to their own verified login on this page.' : 'Access draft saved. Publish the Firebase rules using Finish secure permission setup before this login can edit shared data.');
    editor();
  } catch(error) {message('Access was not saved: '+error.message,true);}
  finally {$('saveUser').disabled=false;}
};
