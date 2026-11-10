import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionFromUrl, sectionUrl } from '../public/navigation.js';
test('navegación conserva sección explícita, sin rutas o destinos arbitrarios', () => {
  assert.equal(sectionFromUrl('http://localhost:4318/gestion?section=transport'), 'transport');
  assert.equal(sectionFromUrl('/gestion?section=%3Cscript%3E'), 'daily');
  assert.equal(sectionFromUrl('/gestion'), 'daily');
  assert.equal(
    sectionUrl('http://localhost:4318/gestion?section=warehouse#old', 'tariffs'),
    '/gestion?section=tariffs',
  );
  assert.throws(() => sectionUrl('http://localhost:4318/gestion', 'https://other.example'));
});
