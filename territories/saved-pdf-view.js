// Keep a selected version's PDF request and links alive across harmless UI refreshes.
// No map, address, boundary or saved-record writes are performed by this viewer.
export function pdfViewKey(version) {
  return JSON.stringify([version.id, version.hallId, version.congregation, version.error,
    version.territory, version.houses, version.pdfRecord?.id, version.pdfRecord?.updatedAt]);
}
export function createSavedPdfView({ isActive, buildPdf, readPdf, reviewDuplicates = null, document = globalThis.document, urlApi = globalThis.URL }) {
  let current = null;
  function clear() {
    if (current?.url) urlApi.revokeObjectURL(current.url);
    current = null;
  }
  function paint(state) {
    if (current !== state || !state.nodes) return;
    const { button, originalButton, reviewButton, resolveButton, status, links } = state.nodes;
    button.disabled = state.busy || Boolean(state.version.error && !state.version.pdfRecord);
    button.textContent = state.busy ? 'Preparing PDF…' : 'View PDF';
    if (originalButton) originalButton.disabled = state.busy;
    if (reviewButton) { reviewButton.hidden = !state.needsReview; reviewButton.disabled = state.busy; }
    if (resolveButton) { resolveButton.hidden = !(state.needsReview || state.built?.reviewCopy); resolveButton.disabled = state.busy || !reviewDuplicates; }
    status.textContent = state.status;
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-busy', String(state.busy));
    links.replaceChildren();
    if (!state.url) return;
    const open = document.createElement('a');
    open.href = state.url; open.target = '_blank'; open.rel = 'noopener'; open.className = 'btn outline';
    open.textContent = state.original ? 'View original saved PDF' : state.built.reviewCopy ? 'View review PDF in new tab' : 'View PDF in new tab';
    const download = document.createElement('a');
    download.href = state.url; download.download = state.built.filename || 'territory.pdf'; download.className = 'btn outline';
    download.textContent = state.original ? 'Download original saved PDF' : state.built.reviewCopy ? 'Download review PDF' : 'Download PDF';
    links.append(open, document.createTextNode(' '), download);
  }
  async function request(state, mode) {
    if (current !== state || state.busy || !isActive()) return;
    state.busy = true;
    state.status = mode === 'original' ? 'Reading the original archived PDF; it may not include your latest edits…' : 'Preparing a PDF of this territory version…';
    paint(state);
    const progress = { get textContent() { return state.status; }, set textContent(value) { state.status = String(value); if (isActive()) paint(state); } };
    try {
      const built = mode === 'original'
        ? { blob: await readPdf(state.version.pdfRecord), filename: state.version.pdfRecord.filename || 'original-territory.pdf' }
        : await buildPdf(state.version, progress, { allowReviewCopy: mode === 'review' });
      if (current !== state || !isActive()) return;
      if (!built?.blob || built.blob.size === 0) throw new Error('The PDF was empty. Try again.');
      if (state.url) urlApi.revokeObjectURL(state.url);
      state.url = urlApi.createObjectURL(built.blob); state.built = built; state.original = mode === 'original'; state.needsReview = false;
      state.status = state.original
        ? 'Original archived PDF ready. This is the earlier saved file, not a confirmation of the latest boundary or address edits.'
        : built.reviewCopy
          ? 'REVIEW COPY ready — unresolved duplicate rows may still be included. Use Review and clean duplicates to combine them, then create a fresh PDF. This is not a cleaned ministry copy. No saved records were changed.'
          : `PDF ready${built.duplicatesRemoved ? ` — ${built.duplicatesRemoved} confirmed repeated address row(s) removed for this print copy` : ''}. Your map and saved work are unchanged.`;
      if (built.archiveReadFailed) state.status += ' The archived file could not be read, so this was rebuilt from its saved address data.';
    } catch (error) {
      if (current !== state || !isActive()) return;
      state.needsReview = error.code === 'PDF_REVIEW_REQUIRED';
      state.status = `Could not prepare the current PDF: ${error.message}${state.needsReview ? ' Select Review and clean duplicates to resolve them. Create review PDF is only for inspection and can still contain duplicate rows.' : ''}${state.version.pdfRecord ? ' View original saved PDF is also available below; it may be older.' : ''}`;
    } finally {
      if (current === state) { state.busy = false; if (isActive()) paint(state); }
    }
  }
  function bind(version, nodes) {
    const key = pdfViewKey(version);
    if (!current || current.key !== key) {
      clear(); current = { key, version, nodes, busy: false, status: '', url: '', built: null, original: false, needsReview: false };
    } else current.nodes = nodes;
    const state = current;
    nodes.button.onclick = () => request(state, 'current');
    if (nodes.originalButton) nodes.originalButton.onclick = () => request(state, 'original');
    if (nodes.reviewButton) nodes.reviewButton.onclick = () => request(state, 'review');
    if (nodes.resolveButton) nodes.resolveButton.onclick = async () => {
      if(current!==state || state.busy || !isActive() || !reviewDuplicates)return;
      state.busy=true;paint(state);
      try { await reviewDuplicates(state.version); }
      catch(error) { if(current===state)state.status=`Could not open duplicate review: ${error.message}`; }
      finally { if(current===state){state.busy=false;if(isActive())paint(state);} }
    };
    paint(state);
  }
  return { bind, clear };
}
