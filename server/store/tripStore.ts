import type { Trip } from '../../src/lib/types.js'

// Where trips live. Each trip is loaded and saved whole. The in-memory store is
// used when MONGODB_URI is empty; the Mongo store arrives with Phase 6.

export interface TripStore {
  readonly kind: 'memory' | 'mongo'
  get(id: string): Promise<Trip | null>
  save(trip: Trip): Promise<void>
}

export class MemoryTripStore implements TripStore {
  readonly kind = 'memory' as const
  private readonly trips = new Map<string, Trip>()

  constructor(private readonly maxTrips = 200) {}

  async get(id: string): Promise<Trip | null> {
    const trip = this.trips.get(id)
    return trip ? structuredClone(trip) : null
  }

  async save(trip: Trip): Promise<void> {
    this.trips.delete(trip.id)
    this.trips.set(trip.id, structuredClone(trip))
    while (this.trips.size > this.maxTrips) {
      const oldest = this.trips.keys().next().value
      if (oldest === undefined) break
      this.trips.delete(oldest)
    }
  }
}
