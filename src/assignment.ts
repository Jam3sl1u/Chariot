/** A normalized rider row: the caller joins RideRequests to Members before planning. */
export interface AssignmentRider {
  requestId: string;
  memberId: string;
  churchId: string;
  zone: string;
  status: 'PENDING' | 'CANCELLED';
  hasPlusOne?: boolean;
}

export interface AssignmentDriver {
  driverId: string;
  churchId: string;
  homeZone: string;
  seatsAvailable: number;
  isAvailableThisWeek: boolean;
}

export interface AssignmentZone {
  zoneId: string;
  zoneName: string;
  zonePriorityOrder: number;
}

export interface Assignment {
  churchId: string;
  driverId: string;
  memberId: string;
  requestId: string;
  seatPosition: number;
  seatsUsed: number;
  unassignedReason?: string;
}

export interface AssignmentInput {
  churchId: string;
  riders: readonly AssignmentRider[];
  drivers: readonly AssignmentDriver[];
  zones: readonly AssignmentZone[];
  /** Cached seed-data distance in feet. Return undefined only when unavailable. */
  distanceFeet?: (fromZone: string, toZone: string) => number | undefined;
  /** Coordinates from pickup_points.csv, used only as a distance fallback. */
  coordinates?: Readonly<Record<string, { latitude: number; longitude: number }>>;
}

const UNASSIGNED_CAPACITY = 'No available driver seats in this church.';
const UNASSIGNED_LOCATION = 'Pickup location needs completion or manual placement.';

function haversineFeet(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLng = (b.longitude - a.longitude) * radians;
  const sinLat = Math.sin(dLat / 2); const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * sinLng * sinLng;
  return 20_925_524.9 * Math.asin(Math.sqrt(h));
}

/**
 * Builds one church's weekly plan without reading or writing external state.
 *
 * Riders and drivers are ordered by the church's fixed zone priority. Stable ID
 * tie-breakers make repeated runs deterministic. A +1 stays with their rider and
 * consumes a second seat. Rows belonging to another church are ignored even if a
 * caller accidentally supplies a mixed collection.
 */
export function assignByZone(input: AssignmentInput): Assignment[] {
  const { churchId, riders, drivers, zones, distanceFeet, coordinates } = input;
  const priority = new Map(
    zones
      .map(zone => [zone.zoneName, zone.zonePriorityOrder]),
  );
  const zoneOrder = (zone: string) => priority.get(zone) ?? Number.POSITIVE_INFINITY;
  const distance = (fromZone: string, toZone: string) => {
    if (fromZone === toZone) return 0;
    const cached = distanceFeet?.(fromZone, toZone);
    if (cached !== undefined) return cached;
    const from = coordinates?.[fromZone]; const to = coordinates?.[toZone];
    return from && to ? haversineFeet(from, to) : 1_000_000_000;
  };

  const eligibleDrivers = drivers
    .filter(driver => driver.churchId === churchId && driver.isAvailableThisWeek && driver.seatsAvailable > 0)
    .map(driver => ({ ...driver, remaining: Math.floor(driver.seatsAvailable), riderCount: 0, lastZone: driver.homeZone }));

  const eligibleRiders = riders
    .filter(rider => rider.churchId === churchId && rider.status === 'PENDING')
    .slice();

  const assignments: Assignment[] = [];
  const remaining = eligibleRiders.filter(rider => {
    if (rider.zone && rider.zone !== 'Other / Not Listed' && priority.has(rider.zone)) return true;
    assignments.push({ churchId, driverId: '', memberId: rider.memberId, requestId: rider.requestId, seatPosition: 0, seatsUsed: rider.hasPlusOne ? 2 : 1, unassignedReason: UNASSIGNED_LOCATION });
    return false;
  });
  while (remaining.length) {
    const candidates = remaining.flatMap((rider, riderIndex) => eligibleDrivers
      .filter(driver => driver.remaining >= (rider.hasPlusOne ? 2 : 1))
      .map(driver => ({ rider, riderIndex, driver, sameHousing: driver.homeZone === rider.zone, distance: distance(driver.lastZone, rider.zone) })));
    if (!candidates.length) {
      assignments.push(...remaining.map(rider => ({ churchId, driverId: '', memberId: rider.memberId, requestId: rider.requestId, seatPosition: 0, seatsUsed: rider.hasPlusOne ? 2 : 1, unassignedReason: UNASSIGNED_CAPACITY })));
      break;
    }
    candidates.sort((a, b) => Number(b.sameHousing) - Number(a.sameHousing) || a.distance - b.distance || zoneOrder(a.rider.zone) - zoneOrder(b.rider.zone) || a.rider.requestId.localeCompare(b.rider.requestId) || a.driver.driverId.localeCompare(b.driver.driverId));
    const best = candidates[0];
    const seatsUsed = best.rider.hasPlusOne ? 2 : 1;
    best.driver.remaining -= seatsUsed;
    best.driver.riderCount += 1;
    best.driver.lastZone = best.rider.zone;
    assignments.push({ churchId, driverId: best.driver.driverId, memberId: best.rider.memberId, requestId: best.rider.requestId, seatPosition: best.driver.riderCount, seatsUsed });
    remaining.splice(best.riderIndex, 1);
  }
  return assignments;
}
