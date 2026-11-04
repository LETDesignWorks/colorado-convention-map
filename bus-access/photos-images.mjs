import {MAX_INPUT_BYTES, MAX_PHOTO_BYTES, MAX_THUMB_BYTES} from './photos-model.mjs';

export async function preparePhoto(file, category, {window: w = globalThis.window, document: d = globalThis.document} = {}) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error('Use JPG, PNG, or WebP photos. Export HEIC photos as JPG first.');
  if (!file.size || file.size > MAX_INPUT_BYTES) throw Error('Each original photo must be no larger than 20 MB.');
  const url = w.URL.createObjectURL(file);
  let image;
  try {
    image = await new Promise((resolve, reject) => {
      const img = new w.Image(), timer = setTimeout(() => {img.src = ''; reject(Error('Photo decoding timed out.'));}, 15000);
      img.onload = () => {clearTimeout(timer); resolve(img);};
      img.onerror = () => {clearTimeout(timer); reject(Error('This file could not be read as a photo.'));};
      img.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60000000) throw Error('Use a photo with fewer than 60 million pixels.');
    // Canvas re-encoding strips EXIF/GPS and produces a consistent PDF-compatible format.
    async function resize(longest, quality, limit) {
      const canvas = d.createElement('canvas'), scale = Math.min(1, longest / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (!context) throw Error('This browser cannot prepare photos.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw Error('Could not prepare this photo.');
      if (blob.size > limit) {
        if (longest <= 600) throw Error('This photo is too large after resizing. Try a smaller original.');
        return resize(Math.round(longest * .75), .78, limit);
      }
      return blob;
    }
    return {id: w.crypto.randomUUID(), category, caption: '', selected: true, createdAt: Date.now(), image: await resize(2400, .88, MAX_PHOTO_BYTES), thumbnail: await resize(480, .78, MAX_THUMB_BYTES)};
  } finally { w.URL.revokeObjectURL(url); }
}
