import { StatusPage } from './StatusPage'
import { TripScreen } from './trip/TripScreen'
import { demoCenter, demoStops, demoTitle } from './trip/demoStops'

export function App() {
  if (window.location.pathname === '/status') return <StatusPage />
  return <TripScreen title={demoTitle} center={demoCenter} stops={demoStops} />
}
