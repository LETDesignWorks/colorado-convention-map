const siteHomeUrl = new URL('../', import.meta.url).href;

function addTerritoriesLink() {
  if (location.pathname.includes('/territories/')) return;
  if (document.querySelector('a[href*="territories/"]')) return;
  const nav = document.querySelector('.header-actions, .top-actions, .navlinks, .actions') || document.querySelector('header.nav');
  if (!nav) return;

  const link = document.createElement('a');
  const sample = nav.querySelector('a.btn');
  link.className = `${sample?.className || 'btn secondary'} territories-link`;
  link.href = new URL('territories/', siteHomeUrl).href;
  link.textContent = 'Territories';
  link.setAttribute('aria-label', 'Open the ministry territory planner');

  const links = Array.from(nav.querySelectorAll('a'));
  const insertBefore = links.find(item => /\/(?:south-dtc-rail|activities|routes|route-planner|bus-access)\/?$/.test(new URL(item.href, location.href).pathname));
  nav.insertBefore(link, insertBefore || null);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addTerritoriesLink, { once: true });
} else {
  addTerritoriesLink();
}
