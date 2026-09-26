import type { Collection } from 'mongodb'
import { tripSchema, type TripSummary } from '../../src/lib/schemas.js'
import type { Trip } from '../../src/lib/types.js'

// Where trips live. Each trip is loaded and saved whole, as one document.
// MongoDB when MONGODB_URI is set, otherwise memory (lost on restart).

export interface TripStore {
  readonly kind: 'memory' | 'mongo'
  get(id: string): Promise<Trip | null>
  save(trip: Trip): Promise<void>
  /** Most recently changed first. */
  list(limit: number): Promise<TripSummary[]>
  /** False when there was no such trip. */
  delete(id: string): Promise<boolean>
  ping(): Promise<boolean>
}

/** The database could not be reached or refused the request. */
export class StoreUnavailableError extends Error {
  constructor() {
    super('The trip database is not reachable right now.')
  }
}

export function summarize(trip: Trip): TripSummary {
  return { id: trip.id, title: trip.title, city: trip.request.city, days: trip.days.length, updatedAt: trip.updatedAt }
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

  async list(limit: number): Promise<TripSummary[]> {
    return [...this.trips.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(summarize)
  }

  async delete(id: string): Promise<boolean> {
    return this.trips.delete(id)
  }

  async ping(): Promise<boolean> {
    return true
  }
}

export type TripDoc = Omit<Trip, 'id'> & { _id: string }
type SummaryDoc = { _id: string; title?: string; updatedAt?: string; request?: { city?: string; days?: number } }

/** The few collection calls the store uses, so tests can pass a fake. */
export type TripCollection = {
  findOne(id: string): Promise<TripDoc | null>
  replace(doc: TripDoc): Promise<void>
  remove(id: string): Promise<number>
  recent(limit: number): Promise<SummaryDoc[]>
  ensureIndexes(): Promise<void>
}

export function tripCollection(collection: Collection<TripDoc>): TripCollection {
  return {
    findOne: (id) => collection.findOne({ _id: id }),
    async replace(doc) {
      await collection.replaceOne({ _id: doc._id }, doc, { upsert: true })
    },
    async remove(id) {
      return (await collection.deleteOne({ _id: id })).deletedCount
    },
    recent: (limit) =>
      collection
        .find({}, { projection: { title: 1, updatedAt: 1, 'request.city': 1, 'request.days': 1 } })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray() as Promise<SummaryDoc[]>,
    async ensureIndexes() {
      await collection.createIndex({ updatedAt: -1 })
    },
  }
}

export class MongoTripStore implements TripStore {
  readonly kind = 'mongo' as const
  private indexed: Promise<void> | null = null

  constructor(
    private readonly collection: () => Promise<TripCollection>,
    private readonly log: (message: string) => void = () => {},
    readonly ping: () => Promise<boolean> = async () => true,
  ) {}

  /** Runs a database call, turning driver failures into StoreUnavailableError. */
  private async use<T>(what: string, run: (c: TripCollection) => Promise<T>): Promise<T> {
    try {
      const c = await this.collection()
      this.indexed ??= c.ensureIndexes().catch(() => {
        this.indexed = null
      })
      await this.indexed
      return await run(c)
    } catch (error) {
      this.log(`[store] ${what} failed: ${error instanceof Error ? error.name : 'unknown error'}`)
      throw new StoreUnavailableError()
    }
  }

  async get(id: string): Promise<Trip | null> {
    const doc = await this.use('get', (c) => c.findOne(id))
    if (!doc) return null
    const { _id, ...rest } = doc
    const parsed = tripSchema.safeParse({ ...rest, id: _id })
    if (!parsed.success) {
      // Stored before a schema change or edited by hand. Better to say "not found" than crash the view.
      this.log(`[store] trip ${_id} does not match the trip schema`)
      return null
    }
    return parsed.data
  }

  async save(trip: Trip): Promise<void> {
    const { id, ...rest } = trip
    await this.use('save', (c) => c.replace({ ...rest, _id: id }))
  }

  async list(limit: number): Promise<TripSummary[]> {
    const docs = await this.use('list', (c) => c.recent(limit))
    return docs.map((d) => ({
      id: d._id,
      title: d.title ?? 'Untitled trip',
      city: d.request?.city ?? '',
      days: d.request?.days ?? 0,
      updatedAt: d.updatedAt ?? '',
    }))
  }

  async delete(id: string): Promise<boolean> {
    return (await this.use('delete', (c) => c.remove(id))) > 0
  }
}
