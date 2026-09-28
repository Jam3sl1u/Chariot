export type SeedZone = { zoneId: string; zoneName: string; zonePriorityOrder: number };

// The first eight are the agreed capacity-shortfall order. Every remaining UCI
// housing location deliberately shares priority 9 and is then ordered by request time.
const priorityByName: Record<string, number> = {
  'Mesa Court': 1,
  'Middle Earth': 2,
  'Plaza Verde 1': 3,
  'Plaza Verde 2': 4,
  'Vista del Campo Norte': 5,
  'Vista del Campo': 6,
  'Camino del Sol': 7,
  'Arroyo Vista': 8,
};

export const uciHousingZoneNames = [
  'Stanford Court', 'Princeton Court', 'Oxford Court', 'Ambrose', 'Dartmouth Court',
  'Columbia Court', 'Berkeley Court', 'Harvard Court', 'Cornell Court', 'Mesa Court',
  'Middle Earth', 'Puerta del Sol', 'Verano', 'Arroyo Vista', 'Plaza Verde 1',
  'Plaza Verde 2', 'Vista del Campo Norte', 'Vista del Campo', 'Camino del Sol',
] as const;

export function zonePriorityOrder(zoneName: string): number {
  return priorityByName[zoneName] ?? 9;
}

export const uciHousingZones: readonly SeedZone[] = uciHousingZoneNames.map((zoneName, index) => ({
  zoneId: `uci-housing-${String(index + 1).padStart(2, '0')}`,
  zoneName,
  zonePriorityOrder: zonePriorityOrder(zoneName),
}));
