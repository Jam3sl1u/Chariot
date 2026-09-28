import test from 'node:test';
import assert from 'node:assert/strict';
import { uciHousingZones, zonePriorityOrder } from '../src/zones.js';

test('UCI seed zones use the agreed capacity-shortfall order and keep all others equal', () => {
  assert.deepEqual(uciHousingZones.filter(zone => zone.zonePriorityOrder < 9).map(zone => [zone.zoneName, zone.zonePriorityOrder]), [
    ['Mesa Court', 1], ['Middle Earth', 2], ['Arroyo Vista', 8], ['Plaza Verde 1', 3],
    ['Plaza Verde 2', 4], ['Vista del Campo Norte', 5], ['Vista del Campo', 6], ['Camino del Sol', 7],
  ]);
  assert.equal(zonePriorityOrder('Stanford Court'), 9);
  assert.equal(zonePriorityOrder('A future pickup point'), 9);
});
