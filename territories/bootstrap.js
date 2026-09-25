const version = 'territories-20260925-1';

async function fetchText(path) {
  const response = await fetch(`${path}?v=${version}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} could not be loaded (${response.status}).`);
  return await response.text();
}

try {
  const [template, styles] = await Promise.all([
    fetchText('template.html'),
    fetchText('styles.css')
  ]);
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.appendChild(style);
  document.body.innerHTML = template;
  await import('../assets/branding.js?v=territories-20260925-1');
  await import('./app-main.js?v=territories-20260925-1');
} catch (error) {
  console.error(error);
  document.body.innerHTML = `<div style="margin:18px;padding:16px;border:1px solid #d89b96;border-radius:12px;background:#fff2f1;color:#7f2d28;font:600 14px/1.5 system-ui,sans-serif">The Ministry Territory Planner could not start: ${String(error?.message || error)}</div>`;
}
