import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignByZone,
  type AssignmentDriver,
  type AssignmentRider,
  type AssignmentZone,
} from '../src/assignment.js';

const zones: AssignmentZone[] = [
  { zoneId: 'near', churchId: 'church-a', zoneName: 'Near', zonePriorityOrder: 1 },
  { zoneId: 'far', churchId: 'church-a', zoneName: 'Far', zonePriorityOrder: 2 },
];

const rider = (requestId: string, zone = 'Near', overrides: Partial<AssignmentRider> = {}): AssignmentRider => ({
  requestId,
  memberId: `member-${requestId}`,
  churchId: 'church-a',
  zone,
  status: 'PENDING',
  ...overrides,
});

const driver = (driverId: string, seatsAvailable: number, overrides: Partial<AssignmentDriver> = {}): AssignmentDriver => ({
  driverId,
  churchId: 'church-a',
  homeZone: 'Near',
  seatsAvailable,
  isAvailableThisWeek: true,
  ...overrides,
});

test('no drivers available leaves every rider unassigned with a reason', () => {
  const result = assignByZone({
    churchId: 'church-a',
    zones,
    riders: [rider('rider-1'), rider('rider-2', 'Far')],
    drivers: [driver('unavailable', 4, { isAvailableThisWeek: false })],
  });

  assert.deepEqual(result.map(row => [row.memberId, row.driverId, row.seatPosition]), [
    ['member-rider-1', '', 0],
    ['member-rider-2', '', 0],
  ]);
  assert.ok(result.every(row => row.unassignedReason === 'No available driver seats in this church.'));
});

test('more riders than total seats assigns by zone priority and records overflow', () => {
  const result = assignByZone({
    churchId: 'church-a',
    zones,
    riders: [rider('far-rider', 'Far'), rider('near-b'), rider('near-a')],
    drivers: [driver('driver-1', 2)],
  });

  assert.deepEqual(result.map(row => [row.requestId, row.driverId]), [
    ['near-a', 'driver-1'],
    ['near-b', 'driver-1'],
    ['far-rider', ''],
  ]);
  assert.match(result[2].unassignedReason ?? '', /No available driver seats/);
});

test('a rider with a +1 consumes a driver\'s last two seats', () => {
  const result = assignByZone({
    churchId: 'church-a',
    zones,
    riders: [rider('rider-1'), rider('rider-2', 'Near', { hasPlusOne: true }), rider('rider-3')],
    drivers: [driver('driver-1', 3)],
  });

  assert.deepEqual(result.map(row => [row.requestId, row.driverId, row.seatsUsed, row.seatPosition]), [
    ['rider-1', 'driver-1', 1, 1],
    ['rider-2', 'driver-1', 2, 2],
    ['rider-3', '', 1, 0],
  ]);
});

test('mixed input rows never cross church boundaries', () => {
  const result = assignByZone({
    churchId: 'church-a',
    zones: [
      ...zones,
      { zoneId: 'other-zone', churchId: 'church-b', zoneName: 'Other', zonePriorityOrder: 0 },
    ],
    riders: [
      rider('a-rider'),
      rider('b-rider', 'Other', { churchId: 'church-b' }),
    ],
    drivers: [
      driver('a-driver', 1),
      driver('b-driver', 20, { churchId: 'church-b', homeZone: 'Other' }),
    ],
  });

  assert.deepEqual(result, [{
    churchId: 'church-a',
    driverId: 'a-driver',
    memberId: 'member-a-rider',
    requestId: 'a-rider',
    seatPosition: 1,
    seatsUsed: 1,
  }]);
  assert.ok(result.every(row => row.churchId === 'church-a' && row.driverId !== 'b-driver'));
});
