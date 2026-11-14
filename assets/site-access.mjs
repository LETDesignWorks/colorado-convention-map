import {onIdTokenChanged} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {getFirestore, doc, onSnapshot, getDocFromServer} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {owner, permission, policyId} from './access-model.mjs?v=access-20261114-1';

let account = null, policy = null, ready = false;
export const isOwner = (user = account) => owner(user);
export const canView = section => permission(account, policy, section, ready) !== 'none';
export const canEdit = section => permission(account, policy, section, ready) === 'edit';
export const accessSnapshot = () => ({user: account, policy, ready});
export async function checkAccessRules(db) {
  // Only the new rules allow this server read. A missing document is expected.
  await getDocFromServer(doc(db, 'siteAccessCapabilities', 'v1'));
  return true;
}
export function observeSiteAccess(auth, callback) {
  let generation = 0, stopPolicy = null;
  const emit = () => {
    callback(account);
    window.dispatchEvent(new CustomEvent('convention:access-changed', {detail: accessSnapshot()}));
  };
  const stopAuth = onIdTokenChanged(auth, async user => {
    const token = ++generation;
    stopPolicy?.(); stopPolicy = null;
    account = user; policy = null; ready = owner(user);
    emit();
    if (!user || owner(user) || !user.emailVerified) return;
    try {
      const db = getFirestore(auth.app);
      await checkAccessRules(db);
      if (generation !== token) return;
      stopPolicy = onSnapshot(doc(db, 'reviews', policyId(user.email)), {includeMetadataChanges: true}, snapshot => {
        if (generation !== token) return;
        // Do not grant permissions from an offline or locally modified policy.
        ready = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
        policy = ready && snapshot.exists() ? snapshot.data() : null;
        emit();
      }, () => {
        if (generation !== token) return;
        ready = false; policy = null; emit();
      });
    } catch {
      if (generation !== token) return;
      ready = false; policy = null; emit();
    }
  });
  return () => {generation++; stopPolicy?.(); stopAuth();};
}
