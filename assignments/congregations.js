const PARTS = [
  'congregations2.part01.txt',
  'congregations2.part02.txt',
  'congregations2.part03.txt',
  'congregations2.part04.txt',
  'congregations2.part05.txt',
];
const version = '20260910-2';
const responses = await Promise.all(PARTS.map(name => fetch(`${name}?v=${version}`, { cache: 'no-store' })));
const failed = responses.find(response => !response.ok);
if (failed) throw new Error(`Congregation source data could not be loaded (${failed.status}).`);
const source = (await Promise.all(responses.map(response => response.text()))).join('');
const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
let module;
try { module = await import(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
export const CONGREGATIONS = module.CONGREGATIONS;
export const CONGREGATION_SOURCE = module.CONGREGATION_SOURCE;
