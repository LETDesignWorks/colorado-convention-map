export const PHOTO_LIMIT = 40;
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_THUMB_BYTES = 200 * 1024;
export const CATEGORIES = ['interior', 'exterior'];

export function photoMetadata(photo) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(photo.id || '')) throw Error('Invalid photo identifier.');
  if (!CATEGORIES.includes(photo.category)) throw Error('Choose Interior or Exterior.');
  return {
    id: photo.id, category: photo.category,
    caption: String(photo.caption || '').replace(/\s+/g,' ').trim().slice(0, 180),
    selected: photo.selected !== false,
    createdAt: Number(photo.createdAt) || Date.now()
  };
}

export function validatePhoto(photo) {
  const metadata = photoMetadata(photo);
  for (const [key, limit] of [['image', MAX_PHOTO_BYTES], ['thumbnail', MAX_THUMB_BYTES]]) {
    const blob = photo[key];
    if (!blob || blob.type !== 'image/jpeg' || !blob.size || blob.size > limit) {
      throw Error('The prepared photo is too large or is not a JPEG.');
    }
  }
  return {...metadata, image: photo.image, thumbnail: photo.thumbnail};
}

// Each transaction changes one photo, so another tab cannot replace a whole library.
export function createDevicePhotoStore({indexedDB = globalThis.indexedDB, owner}) {
  if (!owner) throw Error('Administrator sign-in is required.');
  let database;
  const scope = locationId => JSON.stringify([owner, String(locationId)]);
  const key = (locationId, id) => JSON.stringify([owner, String(locationId), id]);
  function open() {
    if (!indexedDB) return Promise.reject(Error('This browser cannot save photos. Use a normal browser window.'));
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('bus-access-photos-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', {keyPath: 'key'}).createIndex('scope', 'scope');
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Close other Bus Access tabs, then retry.'));
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function transact(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', mode), store = transaction.objectStore('photos');
      let result, failure;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || transaction.error || Error('Photo save was interrupted.'));
      transaction.onerror = () => {};
      try { action(store, value => {result = value;}, error => {failure = error; transaction.abort();}); }
      catch (error) { failure = error; transaction.abort(); }
    });
  }
  return {
    kind: 'device',
    list: locationId => transact('readonly', (store, done) => {
      store.index('scope').getAll(scope(locationId)).onsuccess = event => done(event.target.result.map(({key, scope, ...photo}) => photo).sort((a,b) => a.createdAt-b.createdAt));
    }),
    add: (locationId, source) => {
      const photo = validatePhoto(source);
      return transact('readwrite', (store, done, fail) => {
        store.index('scope').count(scope(locationId)).onsuccess = event => {
          if (event.target.result >= PHOTO_LIMIT) return fail(Error(`A location can hold up to ${PHOTO_LIMIT} photos in each library.`));
          store.add({...photo, scope: scope(locationId), key: key(locationId, photo.id)}); done(photo);
        };
      });
    },
    update: (locationId, photo) => transact('readwrite', (store, done, fail) => {
      const metadata = photoMetadata(photo);
      store.get(key(locationId, metadata.id)).onsuccess = event => {
        if (!event.target.result) return fail(Error('This photo was removed in another tab. Refresh the library.'));
        store.put({...event.target.result, ...metadata}); done(metadata);
      };
    }),
    remove: (locationId, id) => transact('readwrite', (store, done) => {store.delete(key(locationId, id)); done();}),
    image: async (locationId, photo) => photo.image,
    thumbnail: async (locationId, photo) => photo.thumbnail
  };
}

export function photoError(error) {
  if (error?.name === 'QuotaExceededError') return 'This device is out of photo storage. Export a PDF or copy photos to shared storage, then remove unneeded device copies.';
  if (/unauthorized|permission-denied/.test(error?.code || '')) return 'Shared photo access was denied. Sign in as the administrator and check the published storage rules.';
  if (/bucket-not-found|project-not-found/.test(error?.code || '')) return 'Shared photo storage is not configured yet.';
  return error?.message || 'The photo operation could not finish. Please retry.';
}
