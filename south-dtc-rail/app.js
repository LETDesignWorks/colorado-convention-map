const PARTS = [
  'app.part1.txt',
  'app.part2.txt',
  'app.part3.txt',
  'app.part4.txt',
  'app.part5.txt',
  'app.part6.txt',
  'app.part7.txt'
];

const version = 'south-dtc-rail-20260910-5';

try {
  await import('../assets/location-address-autofill.js?v=20260910-1');
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
  warning.textContent = `The South DTC Rail Planner could not start: ${error?.message || 'Unknown error'}`;
  host.prepend(warning);
}
