// Bring the selected hall back into view in both the sidebar and the page layout.
export function revealLocationEditor({document: d = globalThis.document, window: w = globalThis.window} = {}) {
  const detail = d.getElementById('detail');
  if (!detail) return;
  const behavior = w.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const toolbar = d.querySelector('.toolbar');
  const sticky = toolbar && w.getComputedStyle(toolbar).position === 'sticky';
  detail.style.scrollMarginTop = `${sticky ? toolbar.getBoundingClientRect().height + 12 : 12}px`;
  detail.setAttribute('tabindex', '-1');
  detail.focus({preventScroll: true});
  d.getElementById('panel')?.scrollTo({top: 0, behavior});
  detail.scrollIntoView({behavior, block: 'start'});
}

