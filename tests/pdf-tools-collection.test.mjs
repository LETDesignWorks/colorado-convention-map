import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollection, formatBytes} from '../pdf-tools/collection.mjs';

const limits = {maxFiles: 50, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024, maxPages: 200};
const document = (name, contents = '%PDF-1.7\nfixture') => ({name, blob: new Blob([contents], {type: 'application/pdf'})});
function ready(collection, item, pageCount = 1) {
  collection.ready(item.id, {pageCount, pages: Array.from({length: pageCount}, () => ({width: 612, height: 792, rotation: 0}))});
}

test('all added PDFs start selected and one snapshot follows the chosen document order', () => {
  const collection = createCollection(limits);
  const [review, parking, territory] = collection.add([document('review.pdf'), document('parking.pdf'), document('territory.pdf')]);
  assert.equal(collection.summary().count, 3);
  assert.equal(collection.summary().canExport, false, 'opening PDFs cannot be exported');
  ready(collection, review, 2); ready(collection, parking, 3); ready(collection, territory, 4);
  assert.deepEqual(collection.snapshot().map(item => item.name), ['review.pdf', 'parking.pdf', 'territory.pdf']);
  collection.select(parking.id, false);
  collection.move(territory.id, -1); collection.move(territory.id, -1);
  assert.deepEqual(collection.snapshot().map(item => item.name), ['territory.pdf', 'review.pdf']);
  assert.equal(collection.summary().pages, 6);
  collection.selectAll(true);
  assert.deepEqual(collection.snapshot().map(item => item.name), ['territory.pdf', 'review.pdf', 'parking.pdf']);
  assert.equal(collection.summary().pages, 9);
  assert.equal(collection.snapshot()[0].blob, territory.blob, 'snapshots use the original immutable PDF bytes');
});

test('a failed selected PDF blocks the complete export until explicitly unchecked or removed', () => {
  const collection = createCollection(limits);
  const [good, bad] = collection.add([document('complete.pdf'), document('protected.pdf')]);
  ready(collection, good, 5);
  collection.fail(bad.id, 'This PDF is password-protected.');
  assert.equal(collection.summary().errors, 1);
  assert.equal(collection.summary().canExport, false);
  assert.throws(() => collection.snapshot(), /Uncheck or remove/);
  assert.equal(collection.items.length, 2, 'failed files remain visible instead of silently disappearing');
  collection.select(bad.id, false);
  assert.equal(collection.summary().canExport, true);
  assert.deepEqual(collection.snapshot().map(item => item.name), ['complete.pdf']);
  collection.selectAll(true);
  assert.equal(collection.summary().canExport, false, 'select all includes errors and never silently skips them');
  collection.remove(bad.id);
  assert.equal(collection.summary().canExport, true);
});

test('clear selection changes inclusion without losing the collection or its ordering', () => {
  const collection = createCollection(limits);
  const [a, b] = collection.add([document('a.pdf'), document('b.pdf')]); ready(collection, a); ready(collection, b);
  collection.selectAll(false);
  assert.equal(collection.items.length, 2);
  assert.equal(collection.summary().count, 0);
  assert.throws(() => collection.snapshot(), /Select at least one/);
  collection.select(b.id, true);
  assert.deepEqual(collection.snapshot().map(item => item.name), ['b.pdf']);
  assert.equal(collection.move(a.id, -1), false);
  assert.equal(collection.move(b.id, 1), false);
});

test('late PDF inspection cannot reintroduce a removed file or change a ready export revision', () => {
  const collection = createCollection(limits);
  const [a, b] = collection.add([document('a.pdf'), document('b.pdf')]);
  const revision = collection.revision;
  ready(collection, a);
  assert.equal(collection.revision, revision, 'inspection completion does not change the chosen collection');
  collection.remove(b.id);
  assert.equal(collection.ready(b.id, {pageCount: 8}), false);
  assert.equal(collection.fail(b.id, 'Late read failure'), false);
  assert.equal(collection.items.length, 1);
  assert.equal(collection.summary().pages, 1);
  const [replacement] = collection.add([document('b.pdf')]);
  assert.notEqual(replacement.id, b.id);
});

test('the page limit applies to the selection, so a large collection can be exported in chosen groups', () => {
  const collection = createCollection(limits);
  const [a, b, c] = collection.add([document('a.pdf'), document('b.pdf'), document('c.pdf')]);
  ready(collection, a, 100); ready(collection, b, 90); ready(collection, c, 20);
  assert.equal(collection.summary().pages, 210);
  assert.equal(collection.summary().canExport, false);
  assert.throws(() => collection.snapshot(), /200 pages/);
  collection.select(c.id, false);
  assert.equal(collection.summary().canExport, true);
  assert.equal(collection.summary().pages, 190);
});

test('an unselected background read can finish or fail while a selected snapshot stays current', () => {
  for (const outcome of ['ready', 'error']) {
    const collection = createCollection(limits);
    const [selected, background] = collection.add([document('selected.pdf'), document('background.pdf')]);
    ready(collection, selected, 3); collection.select(background.id, false);
    assert.equal(collection.summary().canExport, true);
    const revision = collection.revision, snapshot = collection.snapshot();
    if (outcome === 'ready') ready(collection, background, 7);
    else collection.fail(background.id, 'This PDF could not be opened.');
    assert.equal(collection.revision, revision, `${outcome} completion cannot invalidate an in-flight export`);
    assert.deepEqual(collection.snapshot(), snapshot);
    assert.equal(collection.summary().pages, 3);
    assert.equal(collection.summary().canExport, true);
  }
});

test('oversized batches fail atomically and queued transfers reserve file count and bytes', () => {
  const small = {...limits, maxFiles: 3, maxFileBytes: 50, maxTotalBytes: 45};
  const collection = createCollection(small);
  collection.add([document('first.pdf', 'a'.repeat(10))]);
  const reserved = [document('waiting.pdf', 'b'.repeat(10))];
  assert.throws(() => collection.validateBatch([document('one.pdf'), document('two.pdf')], reserved), /room for 1 more/);
  assert.throws(() => collection.validateBatch([document('large.pdf', 'c'.repeat(30))], reserved), /within 45 bytes/);
  assert.throws(() => collection.add([document('one.pdf'), document('two.pdf'), document('three.pdf')]), /room for 2 more/);
  assert.equal(collection.items.length, 1);
  collection.validateBatch([document('last.pdf', 'c'.repeat(10))], reserved);
  assert.equal(collection.items.length, 1, 'validation does not pre-add a queued transfer');
});

test('invalid individual files remain visible with clear errors while good PDFs can be selected separately', () => {
  const collection = createCollection({...limits, maxFileBytes: 30});
  const [empty, wrongType, tooLarge, good] = collection.add([
    document('empty.pdf', ''),
    {name: 'picture.jpg', blob: new Blob(['not a PDF'], {type: 'image/jpeg'})},
    document('large.pdf', 'x'.repeat(31)),
    document('good.pdf')
  ]);
  assert.match(empty.error, /empty/);
  assert.match(wrongType.error, /Choose a PDF/);
  assert.match(tooLarge.error, /larger than/);
  assert.equal(tooLarge.blob, null, 'rejected bytes are not retained');
  ready(collection, good, 2);
  assert.equal(collection.summary().canExport, false);
  collection.selectAll(false); collection.select(good.id, true);
  assert.equal(collection.summary().canExport, true);
  assert.equal(collection.items.length, 4);
});

test('PDF metadata must report actual pages, and file names stay within the local display boundary', () => {
  const collection = createCollection(limits);
  const [item] = collection.add([document('../folder/\u0000review.pdf')]);
  assert.equal(item.name, 'review.pdf');
  collection.ready(item.id, {pageCount: 0});
  assert.equal(item.status, 'error');
  assert.match(item.error, /no readable pages/);
  assert.equal(collection.summary().canExport, false);
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MB');
});
