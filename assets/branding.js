const logoUrl = new URL('./denver-2027-logo.png', import.meta.url).href;
const siteHomeUrl = new URL('../', import.meta.url).href;

function addBrandingStyles() {
  if (document.getElementById('denver-2027-branding-styles')) return;
  const style = document.createElement('style');
  style.id = 'denver-2027-branding-styles';
  style.textContent = `
    .denver-2027-brand-link {
      width: 90px;
      height: 50px;
      padding: 3px 5px;
      border-radius: 11px;
      background: rgba(255,255,255,.97);
      border: 1px solid rgba(255,255,255,.85);
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
      width: 96px;
      height: 54px;
      padding: 4px 6px;
      border-radius: 11px;
      background: rgba(255,255,255,.92);
      border: 1px solid rgba(94,119,143,.46);
      box-shadow: 0 3px 12px rgba(0,24,48,.22);
      pointer-events: none;
      user-select: none;
    }
    .frame-wrap > .denver-2027-map-brand,
    .full-map-frame > .denver-2027-map-brand {
      left: 12px;
    }
    @media (max-width: 760px) {
      .denver-2027-brand-link { width: 66px; height: 38px; padding: 2px 4px; border-radius: 9px; }
      .denver-2027-map-brand { width: 76px; height: 44px; left: 45px; top: 8px; padding: 3px 5px; border-radius: 9px; }
      .frame-wrap > .denver-2027-map-brand,
      .full-map-frame > .denver-2027-map-brand { left: 8px; }
      .topbar-inner > .denver-2027-brand-link { float: left; margin: 0 8px 5px 0; }
      .topbar-inner > .navlinks,
      .topbar-inner > .top-actions { clear: both; }
    }
    @media (max-width: 460px) {
      .denver-2027-brand-link { width: 56px; height: 33px; }
      .denver-2027-map-brand { width: 68px; height: 39px; }
    }
    @media print {
      .denver-2027-map-brand {
        display: flex !important;
        width: 94px;
        height: 53px;
        background: rgba(255,255,255,.96);
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

function applyDenver2027Branding() {
  addBrandingStyles();
  addHeaderLogo();
  addMapLogo();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyDenver2027Branding, { once: true });
} else {
  applyDenver2027Branding();
}
