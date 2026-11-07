// A local, in-memory collection. Selection and order always define the export.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('en-US', {maximumFractionDigits: 1})} MB`;
}

function documentName(value) {
  return String(value || 'Untitled PDF.pdf').replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().trim().slice(0, 240) || 'Untitled PDF.pdf';
}

export function createCollection(limits) {
  const items = [];
  let counter = 0, revision = 0;
  const get = id => items.find(item => item.id === id);
  const retainedBytes = () => items.reduce((sum, item) => sum + (item.blob?.size || 0), 0);

  function validateBatch(documents, reserved = []) {
    if (!Array.isArray(documents) || !documents.length) throw new Error('Choose at least one PDF to add.');
    const count = items.length + reserved.length + documents.length;
    if (count > limits.maxFiles) {
      const room = Math.max(0, limits.maxFiles - items.length - reserved.length);
      throw new Error(room ? `This collection has room for ${room} more PDF${room === 1 ? '' : 's'}. Choose fewer files.` : `This collection already has ${limits.maxFiles} PDFs. Remove a PDF before adding another.`);
    }
    const addedBytes = [...reserved, ...documents].reduce((sum, document) => sum + (Number(document?.blob?.size) || 0), 0);
    if (retainedBytes() + addedBytes > limits.maxTotalBytes) {
      throw new Error(`Keep the collection within ${formatBytes(limits.maxTotalBytes)}. Choose fewer or smaller PDFs.`);
    }
  }

  function add(documents) {
    validateBatch(documents);
    const added = documents.map(document => {
      const name = documentName(document?.name ?? document?.blob?.name);
      const blob = document?.blob, size = Number(blob?.size) || 0;
      let error = '';
      if (!blob || typeof blob.arrayBuffer !== 'function') error = 'This file could not be read. Choose the PDF again.';
      else if (!size) error = 'This PDF is empty. Choose another copy.';
      else if (size > limits.maxFileBytes) error = `This PDF is larger than ${formatBytes(limits.maxFileBytes)}. Choose a smaller copy.`;
      else if (!/\.pdf$/i.test(name) && blob.type !== 'application/pdf') error = 'Choose a PDF file.';
      const item = {id: `pdf-${++counter}`, name, blob: error ? null : blob, size, selected: true, status: error ? 'error' : 'reading', error, pageCount: 0, pages: []};
      items.push(item);
      return item;
    });
    revision++;
    return added;
  }

  function ready(id, information) {
    const item = get(id);
    if (!item || item.status !== 'reading') return false;
    const count = information?.pageCount;
    if (!Number.isInteger(count) || count < 1) return fail(id, 'This PDF has no readable pages. Choose another copy.');
    item.pageCount = count;
    item.pages = information.pages || [];
    item.status = 'ready';
    item.error = '';
    return true;
  }

  function fail(id, message) {
    const item = get(id);
    if (!item) return false;
    item.status = 'error';
    item.error = String(message || 'This PDF could not be opened. Choose another copy.');
    item.blob = null;
    item.pageCount = 0;
    item.pages = [];
    return true;
  }

  function summary() {
    const selected = items.filter(item => item.selected);
    const pages = selected.reduce((sum, item) => sum + item.pageCount, 0);
    const bytes = selected.reduce((sum, item) => sum + item.size, 0);
    const reading = selected.filter(item => item.status === 'reading').length;
    const errors = selected.filter(item => item.status === 'error').length;
    let blocker = '';
    if (!selected.length) blocker = items.length ? 'Select at least one PDF to download.' : 'Add PDFs to start your collection.';
    else if (reading) blocker = `Opening ${reading} selected PDF${reading === 1 ? '' : 's'}…`;
    else if (errors) blocker = `Uncheck or remove ${errors === 1 ? 'the PDF' : `the ${errors} PDFs`} with an error to continue.`;
    else if (pages > limits.maxPages) blocker = `The selection has ${pages} pages. Choose PDFs totaling ${limits.maxPages} pages or fewer.`;
    else if (bytes > limits.maxTotalBytes) blocker = `Select PDFs totaling ${formatBytes(limits.maxTotalBytes)} or less.`;
    return {count: selected.length, pages, bytes, reading, errors, canExport: !blocker, blocker};
  }

  return {
    items, get, add, ready, fail, summary, validateBatch,
    get revision() { return revision; },
    touch() { revision++; },
    select(id, selected) {
      const item = get(id);
      if (!item || item.selected === Boolean(selected)) return false;
      item.selected = Boolean(selected); revision++; return true;
    },
    selectAll(selected) {
      const next = Boolean(selected);
      if (items.every(item => item.selected === next)) return false;
      items.forEach(item => { item.selected = next; }); revision++; return true;
    },
    move(id, direction) {
      if (direction !== -1 && direction !== 1) return false;
      const from = items.findIndex(item => item.id === id), to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return false;
      const [item] = items.splice(from, 1); items.splice(to, 0, item); revision++; return true;
    },
    remove(id) {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return null;
      const [item] = items.splice(index, 1); revision++; return item;
    },
    snapshot() {
      const state = summary();
      if (!state.canExport) throw new Error(state.blocker);
      return items.filter(item => item.selected).map(item => ({name: item.name, blob: item.blob}));
    }
  };
}
