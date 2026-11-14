import {PDF_BUILDER_URL, openPdfBuilderWindow} from './pdf-tools-link.mjs?v=packets-20261107-1';

export const SITE_TABS = [
  ['', 'Full Planning Map'], ['operating-plan/', 'Operating Plan'],
  ['assignments/', 'Congregation Assignments'], ['territories/', 'Territories'],
  ['bus-access/', 'Bus Access Review'], ['routes/', 'Field Service Routes'],
  ['rush-hour/', 'Rush-hour Routes'], ['activities/', 'Delegate Activities'],
  ['activity-planning/', 'Activity Planning'], ['smpw/', 'SMPW'],
  ['south-dtc-rail/', 'South DTC Rail'], ['team/', 'Team Assignments'],
  ['pdf-tools/', 'PDFs & PowerPoint'], ['map-fullscreen.html', 'Full Screen Map'],
  ['access/', 'Sign-in & Access']
];
const base = new URL('../', import.meta.url);
const pathOf = value => new URL(value, location.href).pathname.replace(/index\.html$/, '').replace(/\/$/, '');
export function mountSiteNavigation() {
  let nav = document.querySelector('.header-actions, .top-actions, header .navlinks, header .actions, header .site-nav, body > nav[aria-label]');
  if (!nav) {
    const header = document.querySelector('header');
    nav = document.createElement('nav');
    if (header) {
      for (const child of [...header.children]) if (child.matches('a.btn, button.btn')) nav.append(child);
      header.append(nav);
    } else document.body.prepend(nav);
  }
  if (!nav.classList.contains('convention-navigation')) {
    nav.classList.add('convention-navigation');
    nav.setAttribute('aria-label', 'All planning sections');
  }
  const existing = [...nav.querySelectorAll('a[href]')];
  const fragment = document.createDocumentFragment();
  for (const [path, label] of SITE_TABS) {
    const url = new URL(path, base);
    const matches = existing.filter(a => pathOf(a.href) === pathOf(url) && new URL(a.href).searchParams.get('mode') !== 'rtd');
    const link = matches.shift() || document.createElement('a');
    matches.forEach(a => a.remove());
    link.href = url.href;
    link.textContent = label;
    link.className = 'btn light convention-tab';
    link.dataset.siteTab = path || 'home';
    const active = pathOf(location.href) === pathOf(url) || (path === 'team/' && location.pathname.includes('/team/'));
    link.classList.toggle('is-current-page', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    if (path === 'pdf-tools/' && !link.dataset.pdfNavBound) {
      link.href = PDF_BUILDER_URL;
      link.addEventListener('click', event => {
        if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        try { openPdfBuilderWindow(window); } catch (error) { window.alert(error.message); }
      });
      link.dataset.pdfNavBound = '1';
    }
    fragment.append(link);
  }
  nav.prepend(fragment);
  nav.closest('header')?.classList.add('convention-navigation-header');
}
function start() {
  const css = document.createElement('link'); css.rel = 'stylesheet';
  css.href = new URL('./site-navigation.css?v=access-20261114-1', import.meta.url).href;
  document.head.append(css);
  mountSiteNavigation();
  // Branding adds links synchronously at DOMContentLoaded; reconcile once after it.
  setTimeout(mountSiteNavigation, 0);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
