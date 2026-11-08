/**
 * Firestore security regression for the two Territory collection queries.
 * Only an explicitly configured local Firestore emulator is permitted.
 *
 * Run from the repository root after installing firebase,
 * @firebase/rules-unit-testing and firebase-tools:
 *   npx firebase emulators:exec --only firestore \
 *     --project demo-territory-rules \
 *     --config tests/firebase-territory-emulator.json \
 *     "node --test tests/territory-firestore-rules.emulator.mjs"
 *
 * TERRITORY_FIRESTORE_RULES_FILE can select an earlier rules file to verify
 * that the owner query tests reproduce the original permission-denied error.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';

const projectId = 'demo-territory-rules';
const ownerUid = 'jPTl6zfkjaTbbCJMI7A7xXE2BN93';
const ownerEmail = 'michaeltarin@hotmail.com';
const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(emulatorAddress || '', /^(127\.0\.0\.1|localhost):8085$/,
  'Run only against the local Firestore emulator on port 8085; production access is forbidden.');
const [host, portText] = emulatorAddress.split(':');
const rulesPath = process.env.TERRITORY_FIRESTORE_RULES_FILE
  || new URL('../bus-access/photo-storage/firestore.rules', import.meta.url);
const territoryTypes = [
  'territory-boundary', 'territory-plan', 'territory-plan-chunk',
  'territory-pdf', 'territory-name-choice',
];
const reviewFixtures = [
  ['meeting-point-example', { recordType: 'territory-route-origin', name: 'Synthetic meeting point' }],
  ...territoryTypes.map((recordType, index) => [`territory-example-${index}`, { recordType }]),
  ['ordinary-review-example', { recordType: 'ordinary-review', note: 'Synthetic review' }],
  ['photo-library-example', { type: 'bus-location-photos', locationId: 'example', photos: {} }],
];
let environment;
let owner;
let signedOut;
let unrelated;
let sameEmailOtherUid;
let sameUidOtherEmail;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(portText), rules: readFileSync(rulesPath, 'utf8') },
  });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'halls/synthetic-hall'), { name: 'Synthetic public hall' });
    for (const [id, data] of reviewFixtures) await setDoc(doc(db, `reviews/${id}`), data);
  });
  owner = environment.authenticatedContext(ownerUid, { email: ownerEmail }).firestore();
  signedOut = environment.unauthenticatedContext().firestore();
  unrelated = environment.authenticatedContext('unrelated-test-user', { email: 'unrelated@example.invalid' }).firestore();
  sameEmailOtherUid = environment.authenticatedContext('different-test-uid', { email: ownerEmail }).firestore();
  sameUidOtherEmail = environment.authenticatedContext(ownerUid, { email: 'different@example.invalid' }).firestore();
});

after(async () => { if (environment) await environment.cleanup(); });

function meetingPointQuery(db) {
  return query(collection(db, 'reviews'), where('recordType', '==', 'territory-route-origin'));
}
function territoryRecordsQuery(db) {
  return query(collection(db, 'reviews'), where('recordType', 'in', territoryTypes));
}
function firstSnapshot(target) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(new Error('Timed out waiting for the local Firestore listener'));
    }, 10000);
    unsubscribe = onSnapshot(target, { includeMetadataChanges: true }, snapshot => {
      if (snapshot.metadata.fromCache) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(snapshot);
    }, error => {
      clearTimeout(timer);
      unsubscribe?.();
      reject(error);
    });
  });
}

test('verified owner can listen to the exact meeting-points query', async () => {
  const result = await assertSucceeds(firstSnapshot(meetingPointQuery(owner)));
  assert.deepEqual(result.docs.map(item => item.id), ['meeting-point-example']);
});

test('verified owner can query the exact Territory private-record types', async () => {
  const result = await assertSucceeds(getDocs(territoryRecordsQuery(owner)));
  assert.equal(result.size, territoryTypes.length);
  assert.deepEqual(new Set(result.docs.map(item => item.data().recordType)), new Set(territoryTypes));
});

test('verified owner can list the reviews already individually readable by that identity', async () => {
  const result = await assertSucceeds(getDocs(collection(owner, 'reviews')));
  assert.equal(result.size, reviewFixtures.length);
});

test('signed-out and unrelated identities cannot query private records or read photo metadata', async () => {
  for (const db of [signedOut, unrelated]) {
    await assertFails(getDocs(collection(db, 'reviews')));
    await assertFails(getDocs(meetingPointQuery(db)));
    await assertFails(getDocs(territoryRecordsQuery(db)));
    await assertFails(getDocs(query(collection(db, 'reviews'), where('type', '==', 'bus-location-photos'))));
    await assertFails(getDoc(doc(db, 'reviews/photo-library-example')));
    await assertFails(getDoc(doc(db, 'reviews/ordinary-review-example')));
  }
});

test('admin email with a different UID cannot list private collections or access photo metadata', async () => {
  await assertFails(getDocs(collection(sameEmailOtherUid, 'reviews')));
  await assertFails(getDocs(meetingPointQuery(sameEmailOtherUid)));
  await assertFails(getDocs(territoryRecordsQuery(sameEmailOtherUid)));
  await assertFails(getDocs(query(collection(sameEmailOtherUid, 'reviews'), where('type', '==', 'bus-location-photos'))));
  await assertFails(getDoc(doc(sameEmailOtherUid, 'reviews/photo-library-example')));
  await assertFails(setDoc(doc(sameEmailOtherUid, 'reviews/photo-library-example'), { type: 'bus-location-photos' }));
  await assertFails(deleteDoc(doc(sameEmailOtherUid, 'reviews/photo-library-example')));
});

test('owner UID alone does not grant the new collection-list access', async () => {
  await assertFails(getDocs(collection(sameUidOtherEmail, 'reviews')));
  await assertFails(getDocs(meetingPointQuery(sameUidOtherEmail)));
  await assertFails(getDocs(territoryRecordsQuery(sameUidOtherEmail)));
});

test('existing document-specific access remains unchanged', async () => {
  for (const [id] of reviewFixtures) await assertSucceeds(getDoc(doc(owner, `reviews/${id}`)));
  await assertSucceeds(getDoc(doc(sameEmailOtherUid, 'reviews/ordinary-review-example')));
  await assertSucceeds(getDoc(doc(sameEmailOtherUid, 'reviews/meeting-point-example')));
  await assertSucceeds(getDoc(doc(sameUidOtherEmail, 'reviews/photo-library-example')));
  await assertFails(getDoc(doc(sameUidOtherEmail, 'reviews/ordinary-review-example')));
  await assertSucceeds(setDoc(doc(owner, 'reviews/owner-new-meeting-point'), { recordType: 'territory-route-origin' }));
  await assertSucceeds(deleteDoc(doc(owner, 'reviews/owner-new-meeting-point')));
});

test('public halls stay readable and non-admin hall writes stay denied', async () => {
  for (const db of [owner, signedOut, unrelated, sameEmailOtherUid, sameUidOtherEmail]) {
    await assertSucceeds(getDoc(doc(db, 'halls/synthetic-hall')));
    const result = await assertSucceeds(getDocs(collection(db, 'halls')));
    assert.equal(result.size, 1);
  }
  for (const db of [signedOut, unrelated, sameUidOtherEmail]) {
    await assertFails(setDoc(doc(db, 'halls/synthetic-hall'), { name: 'Disallowed change' }));
    await assertFails(deleteDoc(doc(db, 'halls/synthetic-hall')));
  }
});
