import type { Collection } from 'mongodb'
import { tripSchema, type TripSummary } from '../../src/lib/schemas.js'
import type { Trip } from '../../src/lib/types.js'

// Where trips live. Each trip is loaded and saved whole, as one document.
// MongoDB when MONGODB_URI is set, otherwise memory (lost on restart).

export interface TripStore {
  readonly kind: 'memory' | 'mongo'
  get(id: string): Promise<Trip | null>
  /** Saves a new trip. Any older version is forgotten. */
  save(trip: Trip): Promise<void>
  /** Saves an edited trip and keeps `previous` (one step) for undo. */
  saveEdit(trip: Trip, previous: Trip): Promise<void>
  /** Puts the previous version back. Null when there is nothing to undo. */
  undo(id: string): Promise<Trip | null>
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

/** The restored version cannot be undone again: only one step is kept. */
const restored = (trip: Trip): Trip =>
  trip.lastChange ? { ...trip, lastChange: { ...trip.lastChange, undoable: false } } : trip

export class MemoryTripStore implements TripStore {
  readonly kind = 'memory' as const
  private readonly trips = new Map<string, { trip: Trip; previous: Trip | null }>()

  constructor(private readonly maxTrips = 200) {}

  async get(id: string): Promise<Trip | null> {
    const entry = this.trips.get(id)
    return entry ? structuredClone(entry.trip) : null
  }

  async save(trip: Trip): Promise<void> {
    this.put(trip, null)
  }

  async saveEdit(trip: Trip, previous: Trip): Promise<void> {
    this.put(trip, previous)
  }

  async undo(id: string): Promise<Trip | null> {
    const entry = this.trips.get(id)
    if (!entry?.previous) return null
    const back = restored(entry.previous)
    this.put(back, null)
    return structuredClone(back)
  }

  private put(trip: Trip, previous: Trip | null): void {
    this.trips.delete(trip.id)
    this.trips.set(trip.id, { trip: structuredClone(trip), previous: previous ? structuredClone(previous) : null })
    while (this.trips.size > this.maxTrips) {
      const oldest = this.trips.keys().next().value
      if (oldest === undefined) break
      this.trips.delete(oldest)
    }
  }

  async list(limit: number): Promise<TripSummary[]> {
    return [...this.trips.values()]
      .map((e) => e.trip)
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

export type TripDoc = Omit<Trip, 'id'> & {
  _id: string
  /** The version before the last edit, for undo. */
  previous?: Omit<Trip, 'id'> | null
}
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
    return doc ? this.parse(doc._id, doc) : null
  }

  private parse(id: string, doc: Omit<TripDoc, '_id'> & { _id?: string }): Trip | null {
    const { _id, previous: _previous, ...rest } = doc
    const parsed = tripSchema.safeParse({ ...rest, id })
    if (!parsed.success) {
      // Stored before a schema change or edited by hand. Better to say "not found" than crash the view.
      this.log(`[store] trip ${id} does not match the trip schema`)
      return null
    }
    return parsed.data
  }

  async save(trip: Trip): Promise<void> {
    const { id, ...rest } = trip
    await this.use('save', (c) => c.replace({ ...rest, _id: id, previous: null }))
  }

  async saveEdit(trip: Trip, previous: Trip): Promise<void> {
    const { id, ...rest } = trip
    const { id: _prevId, ...before } = previous
    await this.use('save', (c) => c.replace({ ...rest, _id: id, previous: before }))
  }

  async undo(id: string): Promise<Trip | null> {
    const doc = await this.use('undo', (c) => c.findOne(id))
    if (!doc?.previous) return null
    const back = this.parse(id, doc.previous)
    if (!back) return null
    const trip = restored(back)
    await this.save(trip)
    return trip
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
