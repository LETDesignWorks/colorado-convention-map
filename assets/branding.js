import {PDF_BUILDER_URL,openPdfBuilderWindow} from './pdf-tools-link.mjs?v=packets-20261107-1';
import { mountPrintRibbons } from './pdf-ribbons.mjs?v=ribbons-20261107-1';
import './denver-2027-circular-nav.js?v=sitewide-circles-20260926-2';
import './bus-access-status-sync.js?v=congregation-homes-20261113-1';
import './location-address-autofill.js?v=20260910-3';

const logoUrl = new URL('./denver-2027-logo.png', import.meta.url).href;
const siteHomeUrl = new URL('../', import.meta.url).href;

function addBrandingStyles() {
  if (document.getElementById('denver-2027-branding-styles')) return;
  const style = document.createElement('style');
  style.id = 'denver-2027-branding-styles';
  style.textContent = `
    .denver-2027-brand-link {
      width: 58px;
      height: 58px;
      padding: 2px;
      border-radius: 50%;
      background: rgba(255,255,255,.98);
      border: 1px solid rgba(255,255,255,.9);
      box-shadow: 0 3px 12px rgba(0,24,48,.24);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      text-decoration: none;
      overflow: hidden;
    }
    .denver-2027-brand-link img,
    .denver-2027-map-brand img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .denver-2027-map-brand {
      position: absolute;
      z-index: 890;
      top: 12px;
      left: 52px;
      width: 62px;
      height: 62px;
      padding: 2px;
      border-radius: 50%;
      background: rgba(255,255,255,.94);
      border: 1px solid rgba(94,119,143,.48);
      box-shadow: 0 3px 12px rgba(0,24,48,.22);
      pointer-events: none;
      user-select: none;
      overflow: hidden;
    }
    .frame-wrap > .denver-2027-map-brand,
    .full-map-frame > .denver-2027-map-brand {
      left: 12px;
    }
    @media (max-width: 760px) {
      .denver-2027-brand-link { width: 46px; height: 46px; padding: 2px; }
      .denver-2027-map-brand { width: 52px; height: 52px; left: 45px; top: 8px; padding: 2px; }
      .frame-wrap > .denver-2027-map-brand,
      .full-map-frame > .denver-2027-map-brand { left: 8px; }
      .topbar-inner > .denver-2027-brand-link { float: left; margin: 0 8px 5px 0; }
      .topbar-inner > .navlinks,
      .topbar-inner > .top-actions { clear: both; }
    }
    @media (max-width: 460px) {
      .denver-2027-brand-link { width: 40px; height: 40px; }
      .denver-2027-map-brand { width: 46px; height: 46px; }
    }
    @media print {
      .denver-2027-map-brand {
        display: flex !important;
        width: 58px;
        height: 58px;
        background: rgba(255,255,255,.97);
        box-shadow: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function addHeaderLogo() {
  if (document.querySelector('.denver-2027-brand-link')) return;
  const header = document.querySelector('.header-row, .topbar-inner, header.nav, .nav');
  if (!header) return;

  const link = document.createElement('a');
  link.className = 'denver-2027-brand-link';
  link.href = siteHomeUrl;
  link.setAttribute('aria-label', 'Open the Denver 2027 convention planning map');

  const image = document.createElement('img');
  image.src = logoUrl;
  image.alt = 'Denver 2027';
  image.decoding = 'async';
  link.appendChild(image);
  header.prepend(link);
}

function addMapLogo() {
  if (document.querySelector('.denver-2027-map-brand')) return;
  const mapHost = document.querySelector('.frame-wrap, .full-map-frame, .map-wrap, .map-panel, .map-card, .map-area');
  if (!mapHost) return;
  const position = getComputedStyle(mapHost).position;
  if (position === 'static') mapHost.style.position = 'relative';

  const badge = document.createElement('div');
  badge.className = 'denver-2027-map-brand';
  badge.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img');
  image.src = logoUrl;
  image.alt = '';
  image.decoding = 'async';
  badge.appendChild(image);
  mapHost.appendChild(badge);
}

function navHost() {
  return document.querySelector('.header-actions, .top-actions, .navlinks, .actions') || document.querySelector('header.nav');
}

function insertBeforeRouteOrBus(nav, link) {
  const links = Array.from(nav.querySelectorAll('a'));
  const routeLink = links.find(item => /\/(?:routes|route-planner)\/?$/.test(new URL(item.href, location.href).pathname));
  const busAccessLink = links.find(item => /\/bus-access\/?$/.test(new URL(item.href, location.href).pathname));
  nav.insertBefore(link, routeLink || busAccessLink || null);
}

function linkClassForCurrentPage(extraClass) {
  const path = location.pathname;
  if (path.includes('/bus-access/')) return `btn primary ${extraClass}`;
  if (path.includes('/routes/') || path.includes('/route-planner/') || path.includes('/activities/') || path.includes('/smpw/')) return `btn ghost ${extraClass}`;
  return `btn light ${extraClass}`;
}

function addDelegateActivitiesLink() {
  if (location.pathname.includes('/activities/')) return;
  if (document.querySelector('a[href*="activities/"]')) return;
  const nav = navHost();
  if (!nav) return;

  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('delegate-activities-link');
  link.href = new URL('activities/', siteHomeUrl).href;
  link.textContent = 'Delegate Activities';
  link.setAttribute('aria-label', 'Open the delegate activity and bus availability planner');
  insertBeforeRouteOrBus(nav, link);
}

function addSouthDtcRailLink() {
  if (location.pathname.includes('/south-dtc-rail/')) return;
  if (document.querySelector('a[href*="south-dtc-rail/"]')) return;
  const nav = navHost();
  if (!nav) return;

  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('south-dtc-rail-link');
  link.href = new URL('south-dtc-rail/', siteHomeUrl).href;
  link.textContent = 'South DTC Rail';
  link.setAttribute('aria-label', 'Open the South DTC rail and meeting-point planner');
  insertBeforeRouteOrBus(nav, link);
}

function addSmpwLink() {
  if (location.pathname.includes('/smpw/')) return;
  if (document.querySelector('a[href*="smpw/"]')) return;
  const nav = navHost();
  if (!nav) return;

  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('smpw-link');
  link.href = new URL('smpw/', siteHomeUrl).href;
  link.textContent = 'SMPW';
  link.setAttribute('aria-label', 'Open the SMPW cart location planner');
  insertBeforeRouteOrBus(nav, link);
}

function applyDenver2027Branding() {
  mountPrintRibbons(document);
  addBrandingStyles();
  addHeaderLogo();
  addSouthDtcRailLink();
  addSmpwLink();
  addDelegateActivitiesLink();
  addActivityPlanningLink();
  addPdfToolsLink();
  addRushHourLink();
  addMapLogo();
}

function addActivityPlanningLink() {
  const nav = navHost();
  if (!nav || nav.querySelector('a[href*="activity-planning/"]')) return;
  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('activity-planning-link');
  const destination = new URL('activity-planning/index.html', siteHomeUrl);
  link.href = destination.href;
  link.textContent = 'Activity Planning';
  link.setAttribute('aria-label', 'Plan activity bus routes, multiple stops, timing and delegate costs');
  insertBeforeRouteOrBus(nav, link);
  if (location.pathname.includes('/territories/')) {
    const update = hallId => {
      const url = new URL(destination.href);
      if (hallId) url.searchParams.set('hall', hallId);
      link.href = url.href;
    };
    update(new URLSearchParams(location.search).get('hall'));
    window.addEventListener('territory-planner:data', event => update(event.detail?.hallId || ''));
  }
}


function addRushHourLink() {
  const nav = navHost();
  if (!nav) return;
  const destination = new URL('rush-hour/', siteHomeUrl);
  const existing = [...nav.querySelectorAll('a[href]')].find(a => new URL(a.href, location.href).pathname.replace(/index\.html$/, '').replace(/\/$/, '') === destination.pathname.replace(/\/$/, ''));
  if (existing) return;
  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('rush-hour-link');
  link.href = destination.href;
  link.textContent = 'Rush-hour Routes';
  link.setAttribute('aria-label', 'Rush-hour Routes');
  insertBeforeRouteOrBus(nav, link);
}

function addPdfToolsLink() {
  if (location.pathname.includes('/pdf-tools/') || document.querySelector('a[href*="pdf-tools/"]')) return;
  const nav = navHost();
  if (!nav) return;
  const link = document.createElement('a');
  link.className = linkClassForCurrentPage('pdf-tools-link');
  link.href = PDF_BUILDER_URL;
  link.textContent = 'PDFs & PowerPoint';
  link.setAttribute('aria-label', 'Combine PDFs and create a PowerPoint presentation');
  link.addEventListener('click', event => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try { openPdfBuilderWindow(window); } catch (error) { window.alert(error.message); }
  });
  nav.append(link);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyDenver2027Branding, { once: true });
} else {
  applyDenver2027Branding();
}

