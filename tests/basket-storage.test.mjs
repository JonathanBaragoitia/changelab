import test from 'node:test';
import assert from 'node:assert/strict';
import { basketPriceChanges, readBasket, saveBasket } from '../public/basket-storage.js';
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
test('carrito conserva cantidades e identificador de reintento al navegar sin datos personales', () => {
  const storage = memory(),
    lines = [{ productId: 'nc1', quantity: 3, expectedPriceCents: 7990 }];
  assert.ok(saveBasket(lines, 'basket-request-12345', storage));
  assert.deepEqual(readBasket(storage), { lines, requestId: 'basket-request-12345' });
  saveBasket([], 'basket-request-67890', storage);
  assert.deepEqual(readBasket(storage)?.lines, []);
});
test('carrito descarta datos corruptos, cantidades inválidas y productos duplicados', () => {
  const storage = memory();
  storage.setItem('autocare-basket', 'invalid');
  assert.equal(readBasket(storage), null);
  for (const lines of [
    [{ productId: 'nc1', quantity: -1, expectedPriceCents: 7990 }],
    [
      { productId: 'nc1', quantity: 1, expectedPriceCents: 7990 },
      { productId: 'nc1', quantity: 1, expectedPriceCents: 7990 },
    ],
  ]) {
    saveBasket(lines, 'basket-request-12345', storage);
    assert.equal(readBasket(storage), null);
  }
});
test('el carrito conserva hasta 50 artículos distintos y rechaza el exceso sin perderlos', () => {
  const storage = memory();
  const lines = Array.from({ length: 51 }, (_, index) => ({
    productId: 'nc' + index,
    quantity: 2,
    expectedPriceCents: 7990,
  }));
  const requestId = 'basket-request-12345';
  for (const size of [31, 50]) {
    const accepted = lines.slice(0, size);
    assert.ok(saveBasket(accepted, requestId, storage));
    assert.deepEqual(readBasket(storage), { lines: accepted, requestId });
  }
  assert.equal(saveBasket(lines, requestId, storage), false);
  assert.equal(readBasket(storage).lines.length, 50);
  storage.setItem('autocare-basket', JSON.stringify({ lines, requestId }));
  assert.equal(readBasket(storage), null);
});
test('cargar el catálogo detecta precios nuevos sin modificar importes ni cantidades del carrito', () => {
  const storage = memory();
  const lines = [
    { productId: 'nc1', quantity: 3, expectedPriceCents: 7990 },
    { productId: 'nc2', quantity: 2, expectedPriceCents: 1290 },
    { productId: 'nc3', quantity: 1, expectedPriceCents: 1000 },
  ];
  const requestId = 'basket-request-12345';
  assert.ok(saveBasket(lines, requestId, storage));
  const basket = readBasket(storage);
  const products = [
    { id: 'nc1', priceCents: 8490 },
    { id: 'nc2', priceCents: 1290 },
    { id: 'nc4', priceCents: 1990 },
  ];
  assert.deepEqual([...basketPriceChanges(basket.lines, products)], [['nc1', 8490]]);
  assert.deepEqual(basket, { lines, requestId });
  assert.deepEqual(readBasket(storage), { lines, requestId });
});
test('almacenamiento bloqueado no rompe la tienda', () => {
  const storage = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.equal(readBasket(storage), null);
  assert.equal(saveBasket([], 'basket-request-12345', storage), false);
});
