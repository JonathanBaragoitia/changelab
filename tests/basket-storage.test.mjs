import test from 'node:test';
import assert from 'node:assert/strict';
import { readBasket, saveBasket } from '../public/basket-storage.js';
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
