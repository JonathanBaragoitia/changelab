import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, searchProducts, catalogSuggestions } from '../public/catalog-search.js';
const products = [
  {
    id: 'glass',
    sku: 'NA-010',
    name: 'Limpiacristales para automóvil · 750 ml',
    category: 'Cristales',
  },
  { id: 'shampoo', sku: 'NA-001', name: 'Champú neutro', category: 'Lavado exterior' },
  { id: 'cloth', sku: 'NA-016', name: 'Paño para cristales', category: 'Accesorios' },
];
test('búsqueda ignora acentos, mayúsculas y espacios repetidos', () => {
  assert.equal(normalizeSearch('  CHAMPÚ   NEUTRO '), 'champu neutro');
  assert.deepEqual(
    searchProducts(products, 'champu NEUTRO').map((p) => p.id),
    ['shampoo'],
  );
  assert.deepEqual(
    searchProducts(products, 'automovil').map((p) => p.id),
    ['glass'],
  );
});
test('búsqueda por SKU y varios términos respeta la categoría', () => {
  assert.deepEqual(
    searchProducts(products, 'na-010').map((p) => p.id),
    ['glass'],
  );
  assert.deepEqual(
    searchProducts(products, 'cristales 750').map((p) => p.id),
    ['glass'],
  );
  assert.deepEqual(
    searchProducts(products, 'cristales', 'Cristales').map((p) => p.id),
    ['glass'],
  );
  assert.deepEqual(searchProducts(products, 'na-010', 'Accesorios'), []);
});
test('sugerencias vacías no inventan resultados y priorizan el inicio del nombre', () => {
  assert.deepEqual(catalogSuggestions(products, ''), []);
  assert.deepEqual(catalogSuggestions(products, 'inexistente'), []);
  assert.equal(catalogSuggestions(products, 'limpia')[0].id, 'glass');
});
test('sugerencias limitadas sin modificar el catálogo recibido', () => {
  const source = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      sku: 'P' + i,
      name: 'Producto ' + i,
      category: 'Prueba',
    })),
    before = structuredClone(source);
  assert.equal(catalogSuggestions(source, 'producto').length, 6);
  assert.deepEqual(source, before);
});
