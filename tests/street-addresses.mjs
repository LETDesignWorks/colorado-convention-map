import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { streetAddressInfo, compareStreetAddresses, groupAddressesByStreet, drawStreetAddressColumns } from '../territories/street-addresses.js';

const addresses = ['100 Main Street Apt 10', '12 Oak Road', '100 Main St Apt 2', '2 Main St',
  '12 1/2 Main St', '12A Main St', '12 Main St', '10 Oak Rd', 'PO Box 6'];
const houses = addresses.map((address, id) => ({ address, id: String(id), included: true }));
const groups = groupAddressesByStreet(houses);
assert.deepEqual(groups.map(g => g.name), ['Main St', 'Oak Rd', 'Other addresses']);
assert.deepEqual(groups[0].houses.map(h => h.address), ['2 Main St', '12 Main St', '12A Main St',
  '12 1/2 Main St', '100 Main St Apt 2', '100 Main Street Apt 10']);
assert.equal(streetAddressInfo({ address: '100 North Main Street, Denver, CO' }).key,
  streetAddressInfo({ address: '100 N. Main St Apt 2' }).key);
assert.equal(streetAddressInfo({ address: '123½ Main St' }).numberValue, 123.5);
assert.equal(streetAddressInfo({ address: '123-125 Main St' }).number, '123-125');

// A street that crosses columns and pages must keep every address, in order,
// and repeat its heading without stranding one at the bottom of a column.
const many = Array.from({ length: 180 }, (_, i) => ({ address: `${i + 1} ${i < 140 ? 'Main St' : 'Oak Rd'}` }));
const calls = []; let page = 0;
const doc = { setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, circle() {},
  splitTextToSize: text => [text], text: (lines, x, y) => calls.push({ text: lines.join(' '), x, y, page }) };
let index = 0;
while (index < many.length) { index = drawStreetAddressColumns(doc, many, index); page++; }
assert.ok(page > 2);
assert.deepEqual(calls.filter(c => /^\d+\./.test(c.text)).map(c => c.text), many.map((h, i) => `${i + 1}. ${h.address}`));
assert.ok(calls.some(c => c.text === 'Main St (continued)'));
for (let i = 0; i < calls.length; i++) if (!/^\d+\./.test(calls[i].text)) {
  assert.equal(calls[i + 1].page, calls[i].page);
  assert.equal(calls[i + 1].x, calls[i].x);
  assert.ok(calls[i + 1].y > calls[i].y);
}

// Exercise the actual directory renderer without loading Firebase or user data.
const source = await readFile(new URL('../territories/app-main.js', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function renderHouseList()'), source.indexOf('\nfunction ', source.indexOf('function renderHouseList()') + 1));
const list = { innerHTML: '', querySelectorAll: () => [] };
const context = { houses, territories: [], clean: value => String(value).trim(), els: { houseList: list, houseSearch: { value: '' } },
  HOUSE_LIST_LIMIT: 500, compareStreetAddresses, streetAddressInfo, escapeHtml: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  selectedHouseIds: new Set(), TERRITORY_COLORS: ['blue'], mapHouseIsUploaded: () => false };
vm.runInNewContext(renderer + '\nrenderHouseList();', context);
assert.equal((list.innerHTML.match(/class="house-street-heading"/g) || []).length, 3);
assert.ok(list.innerHTML.indexOf('2 Main St') < list.innerHTML.indexOf('100 Main St Apt 2'));
assert.ok(list.innerHTML.indexOf('100 Main Street Apt 10') < list.innerHTML.indexOf('10 Oak Rd'));
console.log('Street normalization, numeric/unit order, pagination, and directory grouping passed.');
