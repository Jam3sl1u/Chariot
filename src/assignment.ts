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
}

const UNASSIGNED_CAPACITY = 'No available driver seats in this church.';

/**
 * Builds one church's weekly plan without reading or writing external state.
 *
 * Riders and drivers are ordered by the church's fixed zone priority. Stable ID
 * tie-breakers make repeated runs deterministic. A +1 stays with their rider and
 * consumes a second seat. Rows belonging to another church are ignored even if a
 * caller accidentally supplies a mixed collection.
 */
export function assignByZone({ churchId, riders, drivers, zones }: AssignmentInput): Assignment[] {
  const priority = new Map(
    zones
      .map(zone => [zone.zoneName, zone.zonePriorityOrder]),
  );
  const zoneOrder = (zone: string) => priority.get(zone) ?? Number.POSITIVE_INFINITY;

  const eligibleDrivers = drivers
    .filter(driver => driver.churchId === churchId && driver.isAvailableThisWeek && driver.seatsAvailable > 0)
    .map(driver => ({ ...driver, remaining: Math.floor(driver.seatsAvailable), riderCount: 0 }))
    .sort((a, b) => zoneOrder(a.homeZone) - zoneOrder(b.homeZone) || a.driverId.localeCompare(b.driverId));

  const eligibleRiders = riders
    .filter(rider => rider.churchId === churchId && rider.status === 'PENDING')
    .slice()
    .sort((a, b) => zoneOrder(a.zone) - zoneOrder(b.zone) || a.requestId.localeCompare(b.requestId));

  return eligibleRiders.map(rider => {
    const seatsUsed = rider.hasPlusOne ? 2 : 1;
    const driver = eligibleDrivers.find(candidate => candidate.remaining >= seatsUsed);

    if (!driver) {
      return {
        churchId,
        driverId: '',
        memberId: rider.memberId,
        requestId: rider.requestId,
        seatPosition: 0,
        seatsUsed,
        unassignedReason: UNASSIGNED_CAPACITY,
      };
    }

    driver.remaining -= seatsUsed;
    driver.riderCount += 1;
    return {
      churchId,
      driverId: driver.driverId,
      memberId: rider.memberId,
      requestId: rider.requestId,
      seatPosition: driver.riderCount,
      seatsUsed,
    };
  });
}
