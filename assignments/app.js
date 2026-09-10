const PARTS = [
  'app2.part01.txt',
  'app2.part02.txt',
  'app2.part03.txt',
  'app2.part04.txt',
  'app2.part05.txt',
  'app2.part06.txt',
  'app2.part07.txt',
  'app2.part08.txt',
  'app2.part09.txt',
  'app2.part10.txt',
  'app2.part11.txt',
  'app2.part12.txt',
  'app2.part13.txt',
  'app2.part14.txt',
  'app2.part15.txt',
];
const version = '20260910-2';
try {
  const responses = await Promise.all(PARTS.map(name => fetch(`${name}?v=${version}`, { cache: 'no-store' })));
  const failed = responses.find(response => !response.ok);
  if (failed) throw new Error(`Application file could not be loaded (${failed.status}).`);
  const source = (await Promise.all(responses.map(response => response.text()))).join('');
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { await import(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
} catch (error) {
  console.error(error);
  const host = document.querySelector('.side-panel') || document.body;
  const warning = document.createElement('div');
  warning.style.cssText = 'margin:12px;padding:12px;border:1px solid #d89b96;border-radius:10px;background:#fff2f1;color:#7f2d28;font:600 13px/1.4 system-ui,sans-serif';
  warning.textContent = `The Congregation Assignment page could not start: ${error?.message || 'Unknown error'}`;
  host.prepend(warning);
}
