// Visible progress without claiming a percentage for work whose duration is unknown.
const tasks = new Map();
let box, text, clock, timer;
export const paintBeforeWork = () => new Promise(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
  else setTimeout(resolve, 0);
});
function mount() {
  if (box?.isConnected || typeof document === 'undefined' || !document.body) return;
  box = document.createElement('div'); box.id = 'plannerLoading'; box.hidden = true;
  box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  box.innerHTML = '<span class="planner-spinner" aria-hidden="true"></span><span><strong id="plannerLoadingText"></strong><small id="plannerLoadingClock"></small></span>';
  const style = document.createElement('style');
  style.textContent = '#plannerLoading{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;gap:12px;align-items:center;max-width:min(540px,90vw);padding:14px 20px;border:1px solid #9dbad3;border-radius:12px;background:#fff;color:#143e63;box-shadow:0 5px 22px #102c4a35;font:14px/1.5 system-ui;pointer-events:none}#plannerLoading[hidden]{display:none}#plannerLoading small{display:block;font-size:12px}.planner-spinner{width:22px;height:22px;border:3px solid #dae6ef;border-top-color:#1764a1;border-radius:50%;animation:planner-spin .8s linear infinite;flex:none}@keyframes planner-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.planner-spinner{animation:none}}';
  document.head.appendChild(style); document.body.appendChild(box);
  text = box.querySelector('strong'); clock = box.querySelector('small');
}
function render() {
  mount(); if (!box) return;
  const entries = [...tasks.values()]; box.hidden = !entries.length;
  document.querySelector('#map')?.setAttribute('aria-busy', String(Boolean(entries.length)));
  clearInterval(timer); if (!entries.length) return;
  const last = entries[entries.length - 1]; text.textContent = last.message;
  const tick = () => {
    const seconds = Math.floor((Date.now() - last.started) / 1000);
    clock.textContent = seconds < 10 ? 'Loading addresses, boundaries and saved work…' : `${seconds}s elapsed — still loading. You can select another meeting place.`;
  };
  tick(); timer = setInterval(tick, 1000);
}
export function startLoading(key, message) { tasks.set(key, { message, started: Date.now() }); render(); }
export function stopLoading(key) { tasks.delete(key); render(); }
export function clearLoading() { tasks.clear(); render(); }
