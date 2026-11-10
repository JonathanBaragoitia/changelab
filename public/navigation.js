const sections = new Set([
  'mail',
  'shipping',
  'daily',
  'proposals',
  'approvals',
  'tariffs',
  'campaigns',
  'shop',
  'warehouse',
  'billing',
  'reconciliation',
  'cash',
  'economics',
  'suppliers',
  'business',
  'purchases',
  'returns',
  'incidents',
  'transport',
  'imports',
  'followup',
  'catalog',
  'audit',
]);
export function sectionFromUrl(value) {
  const section = new URL(value, 'http://localhost').searchParams.get('section');
  return sections.has(section) ? section : 'daily';
}
export function sectionUrl(value, section) {
  if (!sections.has(section)) throw new Error('Apartado no disponible.');
  const url = new URL(value);
  url.searchParams.set('section', section);
  url.hash = '';
  return url.pathname + url.search;
}
