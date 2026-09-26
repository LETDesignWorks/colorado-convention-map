/**
 * Denver 2027 shared circular navigation
 *
 * Install this file in:
 *   /assets/denver-2027-circular-nav.js
 *
 * Then add this import near the top of /assets/branding.js:
 *   import './denver-2027-circular-nav.js?v=20260926-1';
 *
 * The script finds the existing header navigation on each planning page,
 * applies equal-size circular buttons, protects the page title from being
 * squeezed, and changes the navigation to a horizontal scrolling row on
 * tablets and phones.
 */

const STYLE_ID = 'denver-2027-circular-nav-styles';
const NAV_CLASS = 'denver-2027-circle-nav';
const HEADER_CLASS = 'denver-2027-circle-nav-header';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --denver-circle-nav-size: 84px;
      --denver-circle-nav-gap: 10px;
    }

    .${HEADER_CLASS} {
      align-items: center !important;
      gap: 16px !important;
    }

    .${HEADER_CLASS} > .brand {
      flex: 1 1 260px !important;
      min-width: 230px !important;
      max-width: 390px;
    }

    .${NAV_CLASS} {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-end !important;
      gap: var(--denver-circle-nav-gap) !important;
      flex-wrap: wrap !important;
      min-width: 0;
    }

    .${NAV_CLASS} > .btn {
      width: var(--denver-circle-nav-size) !important;
      height: var(--denver-circle-nav-size) !important;
      min-width: var(--denver-circle-nav-size) !important;
      min-height: var(--denver-circle-nav-size) !important;
      max-width: var(--denver-circle-nav-size) !important;
      flex: 0 0 var(--denver-circle-nav-size) !important;
      aspect-ratio: 1 / 1;
      border-radius: 50% !important;
      padding: 10px !important;
      white-space: normal !important;
      text-align: center !important;
      line-height: 1.12 !important;
      font-size: 10.5px !important;
      font-weight: 850 !important;
      overflow-wrap: anywhere;
      word-break: normal;
      box-shadow: 0 4px 13px rgba(0, 28, 58, .22);
      transition: transform .16s ease, box-shadow .16s ease,
                  background-color .16s ease, border-color .16s ease;
    }

    /* Provide a dependable fallback appearance on pages whose local
       stylesheet does not define light/ghost navigation buttons. */
    .${NAV_CLASS} > .btn:not(.white):not(.primary):not(.save):not(.danger) {
      color: #fff !important;
      background: rgba(255, 255, 255, .12);
      border-color: rgba(255, 255, 255, .48) !important;
    }

    .${NAV_CLASS} > .btn.white {
      color: #083f73 !important;
      background: #fff !important;
      border-color: #fff !important;
    }

    .${NAV_CLASS} > .btn.primary {
      color: #083f73 !important;
      background: #fff !important;
      border-color: #fff !important;
    }

    .${NAV_CLASS} > .btn:hover,
    .${NAV_CLASS} > .btn:focus-visible {
      transform: translateY(-2px);
      box-shadow: 0 7px 17px rgba(0, 28, 58, .30);
    }

    .${NAV_CLASS} > .btn:focus-visible {
      outline: 3px solid #ffd86a;
      outline-offset: 3px;
    }

    .${NAV_CLASS} > .btn.is-current-page {
      outline: 4px solid #ffd86a;
      outline-offset: 2px;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, .72),
                  0 7px 17px rgba(0, 28, 58, .30);
    }

    /* Do not let the circular-button display override hidden controls. */
    .${NAV_CLASS} > [hidden] {
      display: none !important;
    }

    @media (max-width: 1320px) {
      :root {
        --denver-circle-nav-size: 76px;
        --denver-circle-nav-gap: 7px;
      }

      .${HEADER_CLASS} > .brand {
        min-width: 200px !important;
        max-width: 310px;
      }

      .${NAV_CLASS} > .btn {
        padding: 8px !important;
        font-size: 9.5px !important;
      }
    }

    @media (max-width: 980px) {
      :root {
        --denver-circle-nav-size: 72px;
      }

      .${HEADER_CLASS} {
        display: grid !important;
        grid-template-columns: auto minmax(0, 1fr) !important;
        align-items: center !important;
      }

      .${HEADER_CLASS} > .denver-2027-brand-link {
        grid-column: 1;
        grid-row: 1;
        float: none !important;
        margin: 0 10px 0 0 !important;
      }

      .${HEADER_CLASS} > .brand {
        grid-column: 2;
        grid-row: 1;
        min-width: 0 !important;
        max-width: none;
      }

      .${HEADER_CLASS} > .${NAV_CLASS} {
        grid-column: 1 / -1;
        grid-row: 2;
        width: 100%;
        margin-top: 10px !important;
        padding: 2px 2px 8px !important;
        justify-content: flex-start !important;
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        scrollbar-width: thin;
        scroll-snap-type: x proximity;
        -webkit-overflow-scrolling: touch;
      }

      .${NAV_CLASS} > .btn {
        font-size: 9px !important;
        scroll-snap-align: start;
      }

      /* A simple full-screen header can be both the header and navigation
         host. Keep its title and circular return button on one row. */
      .${HEADER_CLASS}.${NAV_CLASS} {
        display: flex !important;
        flex-wrap: nowrap !important;
        overflow: visible !important;
      }

      .${HEADER_CLASS}.${NAV_CLASS} > .brand {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        max-width: none !important;
      }
    }

    @media (max-width: 560px) {
      :root {
        --denver-circle-nav-size: 66px;
        --denver-circle-nav-gap: 6px;
      }

      .${NAV_CLASS} > .btn {
        padding: 7px !important;
        font-size: 8.5px !important;
        line-height: 1.08 !important;
      }
    }

    @media print {
      .${NAV_CLASS} {
        display: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function normalizedPath(url) {
  try {
    let path = new URL(url, window.location.href).pathname;
    path = path.replace(/\/index\.html$/i, '/').replace(/\/+$/, '/');
    return path;
  } catch {
    return '';
  }
}

function markCurrentPage(nav) {
  const currentPath = normalizedPath(window.location.href);
  nav.querySelectorAll('a.btn[href]').forEach(link => {
    const linkPath = normalizedPath(link.href);
    const isCurrent = Boolean(linkPath && linkPath === currentPath);
    link.classList.toggle('is-current-page', isCurrent);
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function findNavigationHosts() {
  const selectors = [
    'header .navlinks',
    'header .actions',
    'header .header-actions',
    'header .top-actions',
    '.topbar .navlinks',
    '.header-row .header-actions',
    'header.nav > .actions'
  ];

  const hosts = Array.from(document.querySelectorAll(selectors.join(',')));

  /* Some full-screen map pages place one or more .btn links directly inside
     <header class="nav"> without a separate nav/actions wrapper. */
  document.querySelectorAll('header.nav').forEach(header => {
    if (Array.from(header.children).some(child => child.classList?.contains('btn'))) {
      hosts.push(header);
    }
  });

  return Array.from(new Set(hosts));
}

function enhanceNavigation() {
  installStyles();

  findNavigationHosts().forEach(nav => {
    nav.classList.add(NAV_CLASS);

    const header = nav.closest('.topbar-inner, .header-row, header.nav, header, .nav');
    if (header) header.classList.add(HEADER_CLASS);

    markCurrentPage(nav);
  });
}

function start() {
  enhanceNavigation();

  /* Branding.js adds some links after the initial page markup. Re-run the
     enhancement when those links appear, without requiring page-specific code. */
  const observer = new MutationObserver(() => enhanceNavigation());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
