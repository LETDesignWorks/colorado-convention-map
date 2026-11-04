import {PHOTO_LIMIT, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, photoMetadata, validatePhoto} from './photos-model.mjs';

// Inject Firebase functions to keep this adapter testable without production writes.
// Metadata is a separate private review document; ordinary review saves cannot overwrite it.
export function createCloudPhotoStore({db, storage, doc, getDocFromServer, runTransaction, ref, uploadBytes, getBlob, deleteObject, isAdmin}) {
  const check = () => {if (!isAdmin()) throw Error('Administrator sign-in is required.');};
  function paths(locationId, id) {
    const locationKey = encodeURIComponent(String(locationId));
    if (!locationKey || locationKey.length > 300) throw Error('Invalid location identifier.');
    return {document: doc(db, 'reviews', `photo-library-${locationKey}`), root: `bus-location-photos/${locationKey}/${id}`};
  }
  async function change(locationId, operation) {
    check(); const p = paths(locationId, '');
    return runTransaction(db, async transaction => {
      check(); const snapshot = await transaction.get(p.document), data = snapshot.exists() ? snapshot.data() : {};
      if (data.type && data.type !== 'bus-location-photos') throw Error('Unexpected photo library record.');
      const photos = {...(data.photos || {})}, result = operation(photos);
      transaction.set(p.document, {type: 'bus-location-photos', locationId: String(locationId), photos});
      return result;
    });
  }
  return {
    kind: 'shared',
    async list(locationId) {
      check(); const snapshot = await getDocFromServer(paths(locationId, '').document); check();
      const data = snapshot.exists() ? snapshot.data() : {};
      if (data.type && data.type !== 'bus-location-photos') throw Error('Unexpected photo library record.');
      return Object.values(data.photos || {}).map(photoMetadata).sort((a,b) => a.createdAt-b.createdAt);
    },
    async add(locationId, source) {
      check(); const photo = validatePhoto(source), p = paths(locationId, photo.id);
      const metadata = {contentType: 'image/jpeg', cacheControl: 'private, no-store', customMetadata: {locationId: String(locationId)}};
      // Upload before committing metadata. Failed or uncertain commits can leave private
      // orphan objects for maintenance, but never a saved entry with missing uploads.
      await uploadBytes(ref(storage, `${p.root}/photo.jpg`), photo.image, metadata); check();
      await uploadBytes(ref(storage, `${p.root}/thumb.jpg`), photo.thumbnail, metadata); check();
      return change(locationId, photos => {
        if (Object.keys(photos).length >= PHOTO_LIMIT && !photos[photo.id]) throw Error(`A location can hold up to ${PHOTO_LIMIT} shared photos.`);
        photos[photo.id] = photoMetadata(photo); return photos[photo.id];
      });
    },
    update: (locationId, source) => change(locationId, photos => {
      const photo = photoMetadata(source);
      if (!photos[photo.id]) throw Error('This photo was removed by another session. Refresh the library.');
      photos[photo.id] = photo; return photo;
    }),
    async remove(locationId, id) {
      const p = paths(locationId, photoMetadata({id, category: 'interior'}).id);
      await change(locationId, photos => {delete photos[id];});
      const results = await Promise.allSettled(['photo.jpg','thumb.jpg'].map(name => {check(); return deleteObject(ref(storage, `${p.root}/${name}`));}));
      if (results.some(r => r.status === 'rejected' && r.reason?.code !== 'storage/object-not-found')) return 'Removed from the library. A stored file still needs administrator cleanup.';
    },
    async image(locationId, photo) {check(); const blob = await getBlob(ref(storage, `${paths(locationId, photo.id).root}/photo.jpg`), MAX_PHOTO_BYTES); check(); return blob;},
    async thumbnail(locationId, photo) {check(); const blob = await getBlob(ref(storage, `${paths(locationId, photo.id).root}/thumb.jpg`), MAX_THUMB_BYTES); check(); return blob;}
  };
}
