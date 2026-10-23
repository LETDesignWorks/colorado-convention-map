const version = 'territories-20261022-43';

async function fetchText(path) {
  const response = await fetch(`${path}?v=${version}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} could not be loaded (${response.status}).`);
  return await response.text();
}

try {
  const [template, styles, circleNavStyles, savedWorkStyles] = await Promise.all([
    fetchText('template.html'),
    fetchText('styles.css'),
    fetchText('circle-nav.css'),
    fetchText('saved-work.css')
  ]);
  const style = document.createElement('style');
  style.textContent = `${styles}\n${circleNavStyles}\n${savedWorkStyles}`;
  document.head.appendChild(style);
  document.body.innerHTML = template;
  await import('../assets/branding.js?v=bus-status-sync-20260927-1');
  await import('./app-main.js?v=territories-20261022-43');
  await import('./address-duplicates-ui.js?v=territories-20261022-43');
  await import('./directions.js?v=territories-20261022-43');
  await import('./bulk-addresses.js?v=territories-20261022-43');
  await import('./avoid-address-upload.js?v=territories-20261022-43');
  await import('./hall-address-sets.js?v=territories-20261022-43');
  await import('./territory-workflow-ui.js?v=territories-20261022-43');
  await import('./territory-flex-grouping-pdf.js?v=territories-20261022-43');
  await import('./address-source-merge.js?v=territories-20261022-43');
  await import('./assessor-scan-direct.js?v=territories-20261022-43');
  await import('./assessor-full-boundary.js?v=territories-20261022-43');
  await import('./assessor-one-click.js?v=territories-20261022-43');
  await import('./modern-basemap.js?v=territories-20261022-43');
  await import('./territory-extra-addresses.js?v=territories-20261022-43');
  await import('./saved-work-ui.js?v=territories-20261022-43');
  await import('./meeting-place-ui.js?v=territories-20261022-43');
  await import('./backup-merge-ui.js?v=territories-20261022-43');
  await import('./library-bulk-cleanup.js?v=territories-20261022-43');
} catch (error) {
  console.error(error);
  document.body.innerHTML = `<div style="margin:18px;padding:16px;border:1px solid #d89b96;border-radius:12px;background:#fff2f1;color:#7f2d28;font:600 14px/1.5 system-ui,sans-serif">The Ministry Territory Planner could not start: ${String(error?.message || error)}</div>`;
}

