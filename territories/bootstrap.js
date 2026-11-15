const version = 'zoom-escape-20261115-1';

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
  // Start independently: other optional tools must not delay this visible card.
  import('./territory-checkout-ui.js?v=ribbons-20261107-1')
    .then(module => module.initializeCheckoutSheet())
    .catch(error => {
      console.warn('Check-in sheet unavailable',error);
      if(document.getElementById('territoryCheckoutSheet'))return;
      const notice=document.createElement('section');notice.id='territoryCheckoutSheet';notice.className='card';notice.setAttribute('role','status');
      notice.textContent='Territory check-out / check-in sheet could not load. Save any unsaved work, then refresh the planner to retry.';
      document.getElementById('savedTerritoriesCard')?.before(notice);
    });
  await import('../assets/branding.js?v=navigation-20261115-2');
  await import('./app-main.js?v=zoom-escape-20261115-1');
  await import('./address-duplicates-ui.js?v=access-20261114-1');
  await import('./directions.js?v=zoom-escape-20261115-1');
  await import('./bulk-addresses.js?v=access-20261114-1');
  await import('./avoid-address-upload.js?v=access-20261114-1');
  await import('./hall-address-sets.js?v=access-20261114-1');
  await import('./territory-workflow-ui.js?v=ribbons-20261107-1');
  await import('./territory-flex-grouping-pdf.js?v=ribbons-20261107-1');
  await import('./address-source-merge.js?v=access-20261114-1');
  await import('./assessor-scan-direct.js?v=access-20261114-1');
  await import('./assessor-full-boundary.js?v=access-20261114-1');
  await import('./assessor-one-click.js?v=access-20261114-1');
  await import('./modern-basemap.js?v=access-20261114-1');
  await import('./territory-extra-addresses.js?v=access-20261114-1');
  await import('./saved-work-ui.js?v=access-20261114-1');
  await import('./meeting-place-ui.js?v=zoom-escape-20261115-1');
  await import('./backup-merge-ui.js?v=access-20261114-1');
  await import('./library-bulk-cleanup.js?v=access-20261114-1');
} catch (error) {
  console.error(error);
  document.body.innerHTML = `<div style="margin:18px;padding:16px;border:1px solid #d89b96;border-radius:12px;background:#fff2f1;color:#7f2d28;font:600 14px/1.5 system-ui,sans-serif">The Ministry Territory Planner could not start: ${String(error?.message || error)}</div>`;
}


