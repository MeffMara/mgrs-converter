// Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const { toLatLon, toDms, splitList, MgrsError } = require('../mgrs.js');

const near = (actual, expected, tolerance = 2e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('перетворює відомі точки в різних півкулях', () => {
  const cases = [
    ['36UUA2418291607', 50.4501, 30.5234],
    ['35UKR86582539', 49.8429, 24.0316, 2e-4],
    ['56HLH3436850948', -33.8688, 151.2093],
  ];
  for (const [mgrs, lat, lon, tolerance] of cases) {
    const point = toLatLon(mgrs);
    near(point.lat, lat, tolerance);
    near(point.lon, lon, tolerance);
  }
});

test('приймає пробіли та малі літери', () => {
  const point = toLatLon(' 36u ua 24182 91607 ');
  assert.strictEqual(point.mgrs, '36U UA 24182 91607');
  assert.strictEqual(point.squareSize, 1);
});

test('визначає розмір квадрата за кількістю цифр', () => {
  assert.strictEqual(toLatLon('36UUA').squareSize, 100000);
  assert.strictEqual(toLatLon('36UUA2491').squareSize, 1000);
});

test('відхиляє хибні значення', () => {
  for (const bad of ['', '36U', '61UUA1234', '36IUA1234', '36UAA1234', '36UUW1234', '36UUA123',
    '36UUA123456789012', '36YUA1234', '32XMA1234', 'З6UUA1234']) {
    assert.throws(() => toLatLon(bad), MgrsError, bad);
  }
});

test('форматує градуси, хвилини й секунди з перенесенням', () => {
  assert.strictEqual(toDms(49.99999999, -0.5), `50°00'00.0"N 0°30'00.0"W`);
});

test('розбиває список координат', () => {
  assert.deepStrictEqual(splitList('36U UA 1 2\r\n\n 37U; 38T,  '), ['36U UA 1 2', '37U', '38T']);
});
