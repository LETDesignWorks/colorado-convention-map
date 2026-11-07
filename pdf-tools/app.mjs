import {PDF_LIMITS, inspectPdf, mergePdfDocuments} from './pdf-merge.mjs?v=packets-20261107-1';
import {createPdfPresentation} from './presentation.mjs?v=packets-20261107-1';
import {createCollection, formatBytes} from './collection.mjs?v=packets-20261107-1';
import {receivePdfTransfers} from './handoff.mjs?v=packets-20261107-1';
import {mountPrintRibbons} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';

const instances = new WeakMap();
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const safeError = error => String(error?.message || 'The file could not be prepared. Please try again.');

export function mountPdfTools({
  document: d = globalThis.document, window: w = globalThis.window,
  inspect = inspectPdf, merge = mergePdfDocuments, present = createPdfPresentation,
  receive = receivePdfTransfers, limits = PDF_LIMITS, mountRibbons = mountPrintRibbons
} = {}) {
  if (!d?.body || !w) throw new Error('The PDF collection page is unavailable.');
  if (instances.has(d)) return instances.get(d);
  const byId = id => d.getElementById(id);
  const nodes = Object.fromEntries([
    'notice', 'drop-zone', 'add-files', 'pdf-files', 'file-limits', 'collection-count',
    'select-all', 'clear-selection', 'empty-collection', 'pdf-list', 'selected-files',
    'selected-pages', 'export-title', 'slide-layout', 'selection-message', 'download-powerpoint',
    'download-pdf', 'export-progress', 'export-progress-text', 'cancel-export', 'download-result',
    'download-result-title', 'download-result-detail', 'download-again', 'collection-limits'
  ].map(id => [id, byId(id)]));
  if (Object.values(nodes).some(node => !node)) throw new Error('The PDF collection page did not load completely.');

  const collection = createCollection(limits), removers = [], readers = new Map();
  const readQueue = [], inboundQueue = [], retiredUrls = new Map();
  let readingCount = 0, activeExport = null, result = null, disposed = false, dragDepth = 0;
  const element = (tag, className, text) => {
    const node = d.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const on = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  function notice(message = '', error = false) {
    if (disposed) return;
    nodes.notice.textContent = message;
    nodes.notice.hidden = !message;
    nodes.notice.classList.toggle('error', error);
    nodes.notice.setAttribute('role', error ? 'alert' : 'status');
  }

  function retireUrl(url) {
    if (!url) return;
    // A click may still be starting its download when the next result is ready.
    const timer = w.setTimeout(() => { w.URL.revokeObjectURL(url); retiredUrls.delete(url); }, 5000);
    retiredUrls.set(url, timer);
  }

  function clearResult() {
    if (result) retireUrl(result.url);
    result = null;
    nodes['download-result'].hidden = true;
    nodes['download-again'].removeAttribute('href');
  }

  function renderResult() {
    nodes['download-result'].hidden = !result;
    if (!result) return;
    const stale = result.revision !== collection.revision;
    const type = result.kind === 'powerpoint' ? 'PowerPoint' : 'Combined PDF';
    nodes['download-result'].classList.toggle('is-stale', stale);
    nodes['download-result-title'].textContent = stale ? `Previous ${type} available` : `${type} ready`;
    const count = result.kind === 'powerpoint' ? plural(result.pages, 'slide') : plural(result.pages, 'page');
    nodes['download-result-detail'].textContent = `${count} from ${plural(result.sourceCount, 'selected PDF')}.${stale ? ' The collection or options have changed. Create a new download to include those changes.' : ' If the download did not start, use the link below.'}`;
    nodes['download-again'].href = result.url;
    nodes['download-again'].download = result.filename;
    nodes['download-again'].textContent = stale ? 'Download previous result' : 'Download again';
  }

  function rememberFocus() {
    const focused = d.activeElement, row = focused?.closest?.('[data-item-id]');
    return row ? {id: row.dataset.itemId, control: focused.dataset.control} : null;
  }

  function restoreFocus(focus) {
    if (!focus || disposed) return;
    const row = nodes['pdf-list'].querySelector(`[data-item-id="${focus.id}"]`);
    let target = row?.querySelector(`[data-control="${focus.control || 'include'}"]`);
    if (!target || target.disabled) target = row?.querySelector('[data-control="include"]');
    if (!target) target = nodes['add-files'];
    if (!target.disabled) target.focus({preventScroll: true});
  }

  function fileRow(item, index) {
    const row = element('li', `pdf-item${item.selected ? ' is-selected' : ''}${item.status === 'error' ? ' has-error' : ''}`);
    row.dataset.itemId = item.id;
    const label = element('label', 'pdf-selection'), check = element('input');
    check.type = 'checkbox'; check.checked = item.selected; check.disabled = Boolean(activeExport);
    check.dataset.control = 'include';
    check.setAttribute('aria-describedby', `meta-${item.id}${item.status !== 'ready' ? ` status-${item.id}` : ''}`);
    label.append(check, element('span', 'sr-only', `Include ${item.name}`));
    const order = element('span', 'file-number', String(index + 1).padStart(2, '0'));
    order.setAttribute('aria-hidden', 'true');
    const info = element('div', 'file-info');
    info.append(element('h3', 'file-name', item.name));
    const meta = element('p', 'file-meta', `${item.status === 'ready' ? `${plural(item.pageCount, 'page')} · ` : ''}${formatBytes(item.size)}`);
    meta.id = `meta-${item.id}`; info.append(meta);
    if (item.status !== 'ready') {
      const status = element('p', `file-status${item.status === 'error' ? ' error' : ''}`, item.status === 'error' ? item.error : 'Opening PDF…');
      status.id = `status-${item.id}`; info.append(status);
    }
    const actions = element('div', 'file-actions');
    for (const [control, text, ariaLabel, disabled] of [
      ['up', '↑ Up', `Move ${item.name} up`, index === 0],
      ['down', '↓ Down', `Move ${item.name} down`, index === collection.items.length - 1],
      ['remove', 'Remove', `Remove ${item.name} from this collection`, false]
    ]) {
      const button = element('button', `button ${control === 'remove' ? 'danger' : 'secondary'}`, text);
      button.type = 'button'; button.dataset.control = control;
      button.setAttribute('aria-label', ariaLabel); button.title = ariaLabel;
      button.disabled = Boolean(activeExport) || disabled; actions.append(button);
    }
    row.append(label, order, info, actions);
    return row;
  }

  function render(focus = rememberFocus()) {
    if (disposed) return;
    const state = collection.summary(), busy = Boolean(activeExport);
    nodes['pdf-list'].replaceChildren(...collection.items.map(fileRow));
    nodes['empty-collection'].hidden = collection.items.length > 0;
    const opening = collection.items.filter(item => item.status === 'reading').length;
    nodes['collection-count'].textContent = collection.items.length ? `${plural(collection.items.length, 'PDF')} in this collection${opening ? `, ${opening} opening` : ''}` : 'No PDFs added';
    nodes['selected-files'].textContent = String(state.count);
    nodes['selected-pages'].textContent = state.reading ? '…' : String(state.pages);
    nodes['selection-message'].textContent = state.blocker || `${plural(state.count, 'PDF')} selected, ${plural(state.pages, 'page')} in order.`;
    nodes['selection-message'].classList.toggle('error', Boolean(state.errors || state.pages > limits.maxPages || state.bytes > limits.maxTotalBytes));
    for (const key of ['add-files', 'pdf-files', 'export-title', 'slide-layout']) nodes[key].disabled = busy;
    nodes['select-all'].disabled = busy || !collection.items.length || collection.items.every(item => item.selected);
    nodes['clear-selection'].disabled = busy || !collection.items.some(item => item.selected);
    nodes['download-powerpoint'].disabled = busy || !state.canExport;
    nodes['download-pdf'].disabled = busy || !state.canExport;
    nodes['export-progress'].hidden = !busy;
    nodes['cancel-export'].disabled = Boolean(activeExport?.controller.signal.aborted);
    nodes['cancel-export'].textContent = activeExport?.controller.signal.aborted ? 'Cancelling…' : 'Cancel export';
    nodes['pdf-list'].setAttribute('aria-busy', String(busy));
    renderResult(); restoreFocus(focus);
  }

  function reportImportComplete() {
    if (disposed || activeExport || readingCount || readQueue.length) return;
    const errors = collection.items.filter(item => item.status === 'error').length;
    if (errors) notice(`${plural(errors, 'PDF')} could not be opened. Check the messages beside those files; uncheck or remove them before exporting.`, true);
    else if (collection.items.length) notice(`${plural(collection.items.length, 'PDF')} ready. Select all or choose individual PDFs, then set their order.`);
  }

  async function readItem(item) {
    const controller = new AbortController(); readers.set(item.id, controller);
    try {
      const info = await inspect(item.blob, {name: item.name, signal: controller.signal, document: d, window: w});
      if (!disposed && !controller.signal.aborted) collection.ready(item.id, info);
    } catch (error) {
      if (!disposed && !controller.signal.aborted && collection.get(item.id)) collection.fail(item.id, safeError(error));
    } finally {
      readers.delete(item.id);
      if (!disposed) render();
    }
  }

  function pumpReads() {
    if (disposed) return;
    while (readingCount < 2 && readQueue.length) {
      const item = readQueue.shift();
      if (!collection.get(item.id) || item.status !== 'reading') continue;
      readingCount++;
      readItem(item).finally(() => { readingCount--; pumpReads(); reportImportComplete(); });
    }
  }

  function addNow(documents) {
    const added = collection.add(documents);
    notice(`Added ${plural(added.length, 'PDF')}. Opening the pages…`);
    render();
    readQueue.push(...added.filter(item => item.status === 'reading'));
    pumpReads(); reportImportComplete();
    return {count: added.length};
  }

  // Transfers are accepted promptly; any active export keeps its original selection.
  function addDocuments(documents) {
    if (disposed) throw new Error('The PDF collection was closed. Open it again to add these PDFs.');
    try { collection.validateBatch(documents, inboundQueue.flat()); }
    catch (error) { notice(safeError(error), true); throw error; }
    if (activeExport) {
      inboundQueue.push(documents);
      setProgress(activeExport.message);
      return {count: documents.length, queued: true};
    }
    return addNow(documents);
  }

  function addFiles(files) {
    if (!files.length) return;
    try { addDocuments(Array.from(files, blob => ({name: blob.name, blob}))); }
    catch (error) { notice(safeError(error), true); }
  }

  function setProgress(message) {
    if (!activeExport || disposed) return;
    activeExport.message = String(message || 'Preparing your download…');
    const queued = inboundQueue.reduce((sum, batch) => sum + batch.length, 0);
    nodes['export-progress-text'].textContent = activeExport.message + (queued ? ` ${plural(queued, 'additional PDF')} will be added after this export.` : '');
  }

  async function exportSelection(kind) {
    if (activeExport || disposed) return;
    let sources;
    try { sources = collection.snapshot(); }
    catch (error) { notice(safeError(error), true); return; }
    const controller = new AbortController(), revision = collection.revision;
    const title = nodes['export-title'].value.trim() || 'Denver 2027 Planning', layout = nodes['slide-layout'].value;
    const current = {controller, revision, kind, message: 'Preparing your selected PDFs…'};
    activeExport = current; notice(); render(); setProgress(current.message);
    try {
      const prepare = kind === 'powerpoint' ? present : merge;
      const built = await prepare(sources, {title, filename: title, layout, signal: controller.signal,
        document: d, window: w, progress: message => { if (activeExport === current) setProgress(message); }});
      if (disposed || controller.signal.aborted) return;
      if (collection.revision !== revision) throw new Error('The collection changed while the file was being prepared. Create the download again.');
      if (!built?.blob?.size || typeof built.blob.arrayBuffer !== 'function') throw new Error('The download was empty. Please try again.');
      const url = w.URL.createObjectURL(built.blob);
      if (result) retireUrl(result.url);
      result = {url, kind, revision, filename: built.filename, pages: built.slides || built.pages, sourceCount: sources.length};
      renderResult();
      nodes['download-again'].click();
      notice(`${kind === 'powerpoint' ? 'PowerPoint' : 'Combined PDF'} ready. Your download should start now.`);
    } catch (error) {
      if (!disposed) notice(controller.signal.aborted || error?.name === 'AbortError' ? 'Export cancelled. Your PDF collection is still here.' : `The download was not created: ${safeError(error)}`, !(controller.signal.aborted || error?.name === 'AbortError'));
    } finally {
      if (activeExport === current) {
        activeExport = null;
        if (!disposed) {
          if (controller.signal.aborted) notice('Export cancelled. Your PDF collection is still here.');
          render();
          const waiting = inboundQueue.splice(0);
          for (const documents of waiting) {
            try { addNow(documents); } catch (error) { notice(safeError(error), true); }
          }
        }
      }
    }
  }

  on(nodes['add-files'], 'click', () => { if (!activeExport) nodes['pdf-files'].click(); });
  on(nodes['pdf-files'], 'change', event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!activeExport) addFiles(files);
  });
  on(nodes['select-all'], 'click', () => { if (!activeExport) { collection.selectAll(true); render(); } });
  on(nodes['clear-selection'], 'click', () => { if (!activeExport) { collection.selectAll(false); render(); } });
  on(nodes['pdf-list'], 'change', event => {
    const control = event.target?.closest?.('[data-control="include"]'), row = control?.closest('[data-item-id]');
    if (!row || !nodes['pdf-list'].contains(row)) return;
    if (!activeExport) collection.select(row.dataset.itemId, control.checked);
    render();
  });
  on(nodes['pdf-list'], 'click', event => {
    const control = event.target?.closest?.('button[data-control]'), row = control?.closest('[data-item-id]');
    if (!row || !nodes['pdf-list'].contains(row) || activeExport) return;
    const id = row.dataset.itemId, action = control.dataset.control;
    if (action === 'up' || action === 'down') {
      collection.move(id, action === 'up' ? -1 : 1); render({id, control: action});
    } else if (action === 'remove') {
      const index = collection.items.findIndex(item => item.id === id);
      readers.get(id)?.abort(); collection.remove(id);
      if (!collection.items.length) { clearResult(); notice(); }
      const next = collection.items[Math.min(index, collection.items.length - 1)];
      render(next ? {id: next.id, control: 'include'} : {id: '', control: ''});
    }
  });
  for (const id of ['export-title', 'slide-layout']) on(nodes[id], id === 'export-title' ? 'input' : 'change', () => {
    if (!activeExport) { collection.touch(); renderResult(); }
  });
  on(nodes['download-powerpoint'], 'click', () => exportSelection('powerpoint'));
  on(nodes['download-pdf'], 'click', () => exportSelection('pdf'));
  on(nodes['cancel-export'], 'click', () => { if (activeExport) { activeExport.controller.abort(); setProgress('Cancelling export…'); render(); } });

  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  on(d, 'dragenter', event => { if (hasFiles(event)) { event.preventDefault(); dragDepth++; if (!activeExport) nodes['drop-zone'].classList.add('is-dragging'); } });
  on(d, 'dragover', event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = activeExport ? 'none' : 'copy'; } });
  on(d, 'dragleave', event => { if (hasFiles(event)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) nodes['drop-zone'].classList.remove('is-dragging'); } });
  on(d, 'drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); dragDepth = 0; nodes['drop-zone'].classList.remove('is-dragging');
    if (activeExport) { notice('Finish or cancel the current export before adding more PDFs.'); return; }
    addFiles(Array.from(event.dataTransfer?.files || []));
  });
  on(w, 'beforeunload', event => {
    if (!activeExport) return;
    event.preventDefault(); event.returnValue = '';
  });
  on(w, 'pagehide', event => { if (!event.persisted) dispose(); });

  function dispose() {
    if (disposed) return;
    disposed = true; activeExport?.controller.abort();
    readers.forEach(controller => controller.abort()); readers.clear();
    readQueue.length = 0; inboundQueue.length = 0;
    removers.forEach(remove => remove());
    if (result) w.URL.revokeObjectURL(result.url);
    retiredUrls.forEach((timer, url) => { w.clearTimeout(timer); w.URL.revokeObjectURL(url); }); retiredUrls.clear();
    collection.items.length = 0; instances.delete(d);
  }

  mountRibbons(d);
  nodes['file-limits'].textContent = `PDF files only. Up to ${limits.maxFiles} files, ${formatBytes(limits.maxFileBytes)} each.`;
  nodes['collection-limits'].textContent = `A collection can hold up to ${limits.maxFiles} PDFs (${formatBytes(limits.maxTotalBytes)} total). Choose up to ${limits.maxPages} pages for each download.`;
  removers.push(receive({window: w, onDocuments: addDocuments}));
  const api = {addDocuments, exportSelection, dispose, collection};
  instances.set(d, api); notice(); render();
  return api;
}
