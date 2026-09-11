const PARTS = [
  'location-address-autofill.part01.txt',
  'location-address-autofill.part02.txt',
  'location-address-autofill.part03.txt',
  'location-address-autofill.part04.txt',
  'location-address-autofill.part05.txt',
  'location-address-autofill.part06.txt'
];

const version = '20260910-2';

try {
  const responses = await Promise.all(PARTS.map(name => fetch(`${name}?v=${version}`, { cache: 'no-store' })));
  const failed = responses.find(response => !response.ok);
  if (failed) throw new Error(`Address geocoder source could not be loaded (${failed.status}).`);
  const source = (await Promise.all(responses.map(response => response.text()))).join('');
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
} catch (error) {
  console.error(error);
  const warning = document.createElement('div');
  warning.style.cssText = 'margin:12px;padding:12px;border:1px solid #d89b96;border-radius:10px;background:#fff2f1;color:#7f2d28;font:600 13px/1.4 system-ui,sans-serif';
  warning.textContent = `Automatic address lookup could not start: ${error?.message || 'Unknown error'}`;
  const host = document.querySelector('.panel, .side-panel, .control-panel') || document.body;
  host.prepend(warning);
}
