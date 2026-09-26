// Vercel entry. Every /api/* request is sent here and handled by the shared app.
import { createApp } from '../server/app.js'

export default createApp(process.env)
