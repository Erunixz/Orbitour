import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadDotEnv, readPort } from './env.js'

loadDotEnv()

const port = readPort(process.env)
const server = createServer(createApp(process.env))

server.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`)
})
