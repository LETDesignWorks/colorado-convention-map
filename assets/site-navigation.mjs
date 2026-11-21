import './bus-access-status-sync.js?v=suitability-20261115-1';
import {PDF_BUILDER_URL, openPdfBuilderWindow} from './pdf-tools-link.mjs?v=packets-20261107-1';

export const SITE_TABS = [
  ['', 'Full Planning Map'],
  ['assignments/', 'Congregation Assignments'], ['territories/', 'Territories'],
  ['load-test-tracker/', 'December Load Test'],
  ['bus-access/', 'Bus Access Review'],
  ['travel-routes/', 'Travel Routes'],
  ['activity-planning/', 'Activity Planning'], ['convention-center/', 'Convention Center'], ['smpw/', 'SMPW'],
  ['south-dtc-rail/', 'South DTC Rail'], ['team/', 'Team Assignments'],
  ['pdf-tools/', 'PDFs & PowerPoint'], ['map-fullscreen.html', 'Full Screen Map'],
  ['access/', 'Sign-in & Access']
];
const base = new URL('../', import.meta.url);
const pathOf = value => new URL(value, location.href).pathname.replace(/index\.html$/, '').replace(/\/$/, '');
export function mountSiteNavigation() {
  let nav = document.querySelector('.convention-navigation') || document.querySelector('.header-actions, .top-actions, header .navlinks, header .actions, header .site-nav, header nav, body > nav[aria-label]');
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
  for (const anchor of [...nav.querySelectorAll('a[href]')]) {
    const url = new URL(anchor.href);
    if (['operating-plan/', 'activities/'].some(path => pathOf(url) === pathOf(new URL(path, base)))) { anchor.remove(); continue; }
    if (['routes/', 'rush-hour/'].some(path => pathOf(url) === pathOf(new URL(path, base)))) {
      const destination = new URL('travel-routes/', base);
      destination.search = url.search; destination.hash = url.hash;
      anchor.href = destination.href; anchor.textContent = 'Travel Routes';
    }
  }
  const existing = [...nav.querySelectorAll('a[href]')];
  const fragment = document.createDocumentFragment();
  for (const [path, label] of SITE_TABS) {
    const url = new URL(path, base);
    const matches = existing.filter(a => pathOf(a.href) === pathOf(url));
    const link = matches.shift() || document.createElement('a');
    matches.forEach(a => a.remove());
    // Keep contextual links (for example a selected territory meeting place).
    if (!link.hasAttribute('href')) link.href = url.href;
    link.textContent = label;
    link.className = 'btn light convention-tab';
    link.dataset.siteTab = path || 'home';
    const active = pathOf(location.href) === pathOf(url) || (path === 'team/' && location.pathname.includes('/team/'));
    link.classList.toggle('is-current-page', active);
    // The legacy circular navigation gives non-white buttons white text.
    link.classList.toggle('white', active);
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
  css.href = new URL('./site-navigation.css?v=travel-20261114-1', import.meta.url).href;
  document.head.append(css);
  mountSiteNavigation();
  // Branding adds links synchronously at DOMContentLoaded; reconcile once after it.
  setTimeout(mountSiteNavigation, 0);
  // Reconcile older cached page modules that may add retired navigation later.
  new MutationObserver(() => {
    const nav = document.querySelector('.convention-navigation');
    if (nav && [...nav.querySelectorAll('a[href]')].some(a =>
      ['routes/', 'rush-hour/', 'operating-plan/', 'activities/'].some(path => pathOf(a.href) === pathOf(new URL(path, base)))
    )) mountSiteNavigation();
  }).observe(document.documentElement, {childList: true, subtree: true});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();

