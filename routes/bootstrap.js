try {
  await import('../assets/location-address-autofill.js?v=20260910-3');
  await import('./app.js?v=automatic-address-coordinates-20260910-1');
} catch (error) {
  console.error(error);
  const host = document.querySelector('.control-panel, .map-column') || document.body;
  const warning = document.createElement('div');
  warning.style.cssText = 'margin:12px;padding:12px;border:1px solid #d89b96;border-radius:10px;background:#fff2f1;color:#7f2d28;font:600 13px/1.4 system-ui,sans-serif';
  warning.textContent = `The Field-Service Route Planner could not start: ${error?.message || 'Unknown error'}`;
  host.prepend(warning);
}
