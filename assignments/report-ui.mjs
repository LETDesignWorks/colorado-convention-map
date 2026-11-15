import {readDelegateSetting, saveDelegateSetting, normalizeDelegateCount} from './report-model.mjs?v=reports-20261115-1';

const number = value => Number(value).toLocaleString('en-US');
const percent = value => Number(value).toLocaleString('en-US', {maximumFractionDigits: 1});
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));

function bars(days, delegates = false) {
  const maximum = Math.max(1, ...days.map(day => delegates ? day.estimatedDelegates : day.totalCongregations));
  return days.map(day => {
    const value = delegates ? day.estimatedDelegates : day.totalCongregations;
    const description = delegates ? `${day.day}: ${number(value)} estimated delegates` : `${day.day}: ${number(value)} scheduled congregations, ${number(day.assignedCongregations)} with meeting locations`;
    const segments = delegates
      ? `<span class="report-bar-delegates" style="width:${value / maximum * 100}%"></span>`
      : `<span class="report-bar-assigned" style="width:${day.assignedCongregations / maximum * 100}%"></span><span class="report-bar-pending" style="width:${day.unassignedCongregations / maximum * 100}%"></span>`;
    return `<div class="report-bar-row" role="img" aria-label="${esc(description)}"><span class="report-day">${esc(day.day.slice(0, 3))}</span><span class="report-bar-track" aria-hidden="true">${segments}</span><strong aria-hidden="true">${number(value)}</strong></div>`;
  }).join('');
}

export function createAssignmentReport(element, {onChange = () => {}, onValidityChange = () => {}, storage} = {}) {
  if (!element) throw Error('The assignment report panel is missing.');
  let settingStorage = storage;
  if (!settingStorage) try { settingStorage = globalThis.localStorage; } catch { /* Private-browser storage can be unavailable. */ }
  let factor = readDelegateSetting(settingStorage);
  element.innerHTML = `<details class="assignment-report-panel" open>
    <summary><span>Assignment progress & delegates</span><small data-report-summary>All congregations</small></summary>
    <div class="assignment-report-body">
      <div class="report-settings"><div><h2>Full congregation roster</h2><p>These charts use saved assignments and service days across every congregation, including those hidden by your directory filters.</p></div>
        <div class="report-factor"><label for="delegatesPerCongregation">Delegates per congregation / meeting-location pair</label><div><input id="delegatesPerCongregation" type="number" min="0" max="10000" step="1" inputmode="numeric" value="${factor}" aria-describedby="delegateSettingNote delegateSettingError"><span>delegates</span></div><small id="delegateSettingNote">Starts at 50. Your report setting is saved on this device.</small><p id="delegateSettingError" role="status" hidden></p></div>
      </div>
      <p class="report-data-status" data-report-status role="status">Loading saved assignments and service days...</p>
      <div data-report-results hidden>
        <div class="report-chart-grid">
          <section class="report-chart" aria-labelledby="assignmentProgressTitle"><h3 id="assignmentProgressTitle">Meeting-location assignments</h3><p class="report-main-count" data-report-count></p><div class="report-progress" role="progressbar" aria-label="Congregations assigned to a meeting location" data-report-progress><span></span></div><div class="report-legend"><span><i class="report-assigned-key"></i>Assigned</span><span><i class="report-pending-key"></i>Awaiting location</span></div><p class="report-progress-note" data-report-progress-note></p></section>
          <section class="report-chart" aria-labelledby="dailyCongregationsTitle"><h3 id="dailyCongregationsTitle">Congregations by service day</h3><div data-congregation-bars></div><div class="report-legend"><span><i class="report-assigned-key"></i>With a meeting location</span><span><i class="report-pending-key"></i>Awaiting location</span></div></section>
          <section class="report-chart" aria-labelledby="dailyDelegatesTitle"><h3 id="dailyDelegatesTitle">Estimated delegates by day</h3><div data-delegate-bars></div><p class="report-formula" data-report-formula></p></section>
        </div>
        <details class="report-table-details"><summary>Daily totals and scheduling details</summary><div class="report-table-wrap"><table><caption>Saved service weekdays and estimated delegates</caption><thead><tr><th scope="col">Service day</th><th scope="col">Congregations scheduled</th><th scope="col">With a meeting location</th><th scope="col">Awaiting location</th><th scope="col">Estimated delegates</th></tr></thead><tbody data-report-days></tbody></table></div><p class="report-scheduling-note" data-report-missing></p><p class="report-counting-note">A congregation scheduled for several days is counted on each day. Congregations sharing one meeting location are counted separately. These are planning estimates, not a count of unique delegates across the week.</p></details>
      </div>
    </div></details>`;
  const query = selector => element.querySelector(selector);
  const input = query('#delegatesPerCongregation');
  const error = query('#delegateSettingError');
  input.addEventListener('input', () => {
    try {
      factor = saveDelegateSetting(input.value, settingStorage);
      input.setCustomValidity(''); input.removeAttribute('aria-invalid'); error.hidden = true; error.textContent = '';
      onValidityChange(true); onChange(factor);
    } catch (issue) {
      input.setCustomValidity(issue.message); input.setAttribute('aria-invalid', 'true'); error.textContent = issue.message; error.hidden = false;
      onValidityChange(false);
    }
  });
  function update(report, {available = true, unavailableMessage = ''} = {}) {
    query('[data-report-results]').hidden = !available;
    query('[data-report-summary]').textContent = available ? `${number(report.assigned)} of ${number(report.total)} assigned` : 'Waiting for saved data';
    const status = query('[data-report-status]');
    status.classList.toggle('report-cached', available && !report.sharedReady);
    status.textContent = !available ? unavailableMessage || 'Loading saved assignments and service days. The graphs and exports will be ready when the shared data arrives.'
      : report.sharedReady ? 'Saved assignments and service days are up to date.' : 'Showing cached shared data. These totals may be incomplete; reconnect before relying on the report.';
    if (!available) return;
    query('[data-report-count]').innerHTML = `<strong>${number(report.assigned)}</strong><span>of ${number(report.total)} congregations assigned</span>`;
    const progress = query('[data-report-progress]');
    progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(report.total || 1)); progress.setAttribute('aria-valuenow', String(report.assigned));
    progress.setAttribute('aria-valuetext', `${number(report.assigned)} of ${number(report.total)} congregations assigned (${percent(report.assignmentPercent)} percent)`);
    progress.querySelector('span').style.width = `${report.assignmentPercent}%`;
    query('[data-report-progress-note]').textContent = `${percent(report.assignmentPercent)}% assigned · ${number(report.unassigned)} awaiting a meeting location.`;
    query('[data-congregation-bars]').innerHTML = bars(report.days);
    query('[data-delegate-bars]').innerHTML = bars(report.days, true);
    query('[data-report-formula]').textContent = `Congregations with a meeting location that day × ${number(report.delegatesPerCongregation)} delegates.`;
    query('[data-report-days]').innerHTML = report.days.map(day => `<tr><th scope="row">${esc(day.day)}</th><td>${number(day.totalCongregations)}</td><td>${number(day.assignedCongregations)}</td><td>${number(day.unassignedCongregations)}</td><td><strong>${number(day.estimatedDelegates)}</strong></td></tr>`).join('');
    query('[data-report-missing]').textContent = `${number(report.assignedWithoutDay)} assigned congregation${report.assignedWithoutDay === 1 ? '' : 's'} still need${report.assignedWithoutDay === 1 ? 's' : ''} a service day. ${number(report.unassignedWithDay)} congregation${report.unassignedWithDay === 1 ? ' has' : 's have'} service days but still need${report.unassignedWithDay === 1 ? 's' : ''} a meeting location.`;
  }
  return {update, getValue: () => factor, validatedValue: () => normalizeDelegateCount(input.value), valid: () => input.validity.valid};
}
