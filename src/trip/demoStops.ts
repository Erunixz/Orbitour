import { centroid } from '../lib/geo'
import type { LatLon, Stop } from '../lib/types'

// Hardcoded Paris day used until planning exists. Summaries are short hand-written
// placeholders; real trips take them from Wikipedia or OSM.

const wiki = (title: string) => ({
  kind: 'wikipedia' as const,
  label: 'Wikipedia',
  url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
})

export const demoStops: Stop[] = [
  {
    id: 'demo-notre-dame',
    name: 'Notre-Dame de Paris',
    kind: 'sight',
    lat: 48.85296,
    lon: 2.3499,
    summary: 'Medieval Catholic cathedral on the Île de la Cité, reopened in 2024 after the 2019 fire.',
    reason: 'A classic start in the historic heart of the city.',
    photo: null,
    sources: [wiki('Notre-Dame de Paris')],
    visitMin: 60,
    arrive: '09:30',
    depart: '10:30',
    mustSee: true,
  },
  {
    id: 'demo-louvre',
    name: 'Louvre Museum',
    kind: 'museum',
    lat: 48.86106,
    lon: 2.33583,
    summary: 'The world\'s most visited art museum, housed in a former royal palace on the Right Bank.',
    reason: 'Short walk along the river and a must for art lovers.',
    photo: null,
    sources: [wiki('Louvre')],
    visitMin: 150,
    arrive: '10:50',
    depart: '13:20',
    mustSee: false,
  },
  {
    id: 'demo-eiffel',
    name: 'Eiffel Tower',
    kind: 'viewpoint',
    lat: 48.85826,
    lon: 2.2945,
    summary: 'Wrought-iron lattice tower on the Champ de Mars, completed in 1889.',
    reason: 'The best-known view over the city.',
    photo: null,
    sources: [wiki('Eiffel Tower')],
    visitMin: 90,
    arrive: '14:00',
    depart: '15:30',
    mustSee: true,
  },
  {
    id: 'demo-arc',
    name: 'Arc de Triomphe',
    kind: 'sight',
    lat: 48.8738,
    lon: 2.29504,
    summary: 'Triumphal arch at the western end of the Champs-Élysées, with a rooftop terrace.',
    reason: 'Close to the tower and a good second view from above.',
    photo: null,
    sources: [wiki('Arc de Triomphe')],
    visitMin: 45,
    arrive: '15:55',
    depart: '16:40',
    mustSee: false,
  },
  {
    id: 'demo-sacre-coeur',
    name: 'Sacré-Cœur',
    kind: 'sight',
    lat: 48.8867,
    lon: 2.3431,
    summary: 'Basilica on the summit of Montmartre, the highest point in the city.',
    reason: 'Ends the day on the hill for sunset over Paris.',
    photo: null,
    sources: [wiki('Sacré-Cœur, Paris')],
    visitMin: 60,
    arrive: '17:15',
    depart: '18:15',
    mustSee: false,
  },
]

export const demoCenter: LatLon = centroid(demoStops)
export const demoTitle = 'A day in Paris'
