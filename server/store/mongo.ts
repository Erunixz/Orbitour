import { MongoClient, type Db } from 'mongodb'

// One shared MongoDB connection, opened on first use. A failed connect is not
// remembered, so the next request tries again. The URI is never logged.

export type MongoHandle = {
  db(): Promise<Db>
  /** True when the database answers a ping in time. */
  ping(): Promise<boolean>
}

const CONNECT_TIMEOUT_MS = 5000

export function connectMongo(uri: string, dbName: string, log: (message: string) => void): MongoHandle {
  let connecting: Promise<Db> | null = null

  const db = (): Promise<Db> => {
    connecting ??= (async () => {
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
        connectTimeoutMS: CONNECT_TIMEOUT_MS,
        appName: 'orbitour',
      })
      try {
        await client.connect()
        log(`[store] connected to MongoDB database "${dbName}"`)
        return client.db(dbName)
      } catch (error) {
        connecting = null
        await client.close().catch(() => {})
        // Driver messages can include the host name but not the password. Keep it short anyway.
        log(`[store] could not connect to MongoDB: ${error instanceof Error ? error.name : 'unknown error'}`)
        throw error
      }
    })()
    return connecting
  }

  return {
    db,
    async ping() {
      try {
        await (await db()).command({ ping: 1 })
        return true
      } catch {
        return false
      }
    },
  }
}
