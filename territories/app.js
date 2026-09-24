const PARTS = Array.from({ length: 4 }, (_, index) => `app.payload.part${String(index).padStart(2, '0')}.txt`);
const version = 'territories-20260923-4';

try {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser needs a newer version to open the territory planner.');
  const responses = await Promise.all(PARTS.map(name => fetch(`${name}?v=${version}`, { cache: 'no-store' })));
  const failed = responses.find(response => !response.ok);
  if (failed) throw new Error(`Territory application file could not be loaded (${failed.status}).`);
  const encoded = (await Promise.all(responses.map(response => response.text()))).join('').trim();
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  let source = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  source = source
    .replace("from '../bus-access/data.js'", `from 'https://letdesignworks.github.io/colorado-convention-map/territories/halls.js?v=${version}'`)
    .replace("from './data.js'", `from 'https://letdesignworks.github.io/colorado-convention-map/territories/data.js?v=${version}'`);
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { await import(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
} catch (error) {
  console.error(error);
  const warning = document.createElement('div');
  warning.style.cssText = 'margin:12px;padding:12px;border:1px solid #d89b96;border-radius:10px;background:#fff2f1;color:#7f2d28;font:600 13px/1.4 system-ui,sans-serif';
  warning.textContent = `The Ministry Territory Planner could not start: ${error?.message || 'Unknown error'}`;
  const host = document.querySelector('.side-panel') || document.body;
  host.prepend(warning);
}
