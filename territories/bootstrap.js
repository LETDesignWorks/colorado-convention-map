const version = 'territories-20260923-3';

async function decodeGzipPayload(path) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser needs a newer version to open the territory planner.');
  const response = await fetch(`${path}?v=${version}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} could not be loaded (${response.status}).`);
  const encoded = (await response.text()).trim();
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

try {
  const [template, styles] = await Promise.all([
    decodeGzipPayload('template.payload.txt'),
    decodeGzipPayload('styles.payload.txt')
  ]);
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.appendChild(style);
  document.body.innerHTML = template;
  await import('../assets/branding.js?v=territories-20260923-3');
  await import('./app.js?v=territories-20260923-3');
} catch (error) {
  console.error(error);
  document.body.innerHTML = `<div style="margin:18px;padding:16px;border:1px solid #d89b96;border-radius:12px;background:#fff2f1;color:#7f2d28;font:600 14px/1.5 system-ui,sans-serif">The Ministry Territory Planner could not start: ${String(error?.message || error)}</div>`;
}
