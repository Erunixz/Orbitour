import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { preferenceAudit } from '../server/pipeline/critic'
import type { Candidate } from '../server/pipeline/context'
import { clash, interestsMatched, preferencePool } from '../server/pipeline/preferences'
import { createFlight, sampleFlight, stopPose } from '../src/map/cameraMath'
import type { Stop } from '../src/lib/types'
import { baseRequest } from './fakes'

const cand = (title: string, description: string, kind: Candidate['kind'], score = 1): Candidate => ({
  pageId: title.length,
  title,
  description,
  kind,
  score,
  lat: 0,
  lon: 0,
})

describe('interestsMatched', () => {
  it('matches by words and by kind', () => {
    expect(interestsMatched(cand('Old Cathedral', 'Gothic cathedral', 'sight'), ['churches', 'architecture', 'parks'])).toEqual([
      'churches',
      'architecture',
    ])
    expect(interestsMatched(cand('Rose Hill', '', 'park'), ['parks'])).toEqual(['parks'])
    expect(interestsMatched(cand('Photo Point', 'Great for photography', 'other'), ['photography'])).toEqual(['photography'])
  })
})

describe('clash', () => {
  it('keeps paid places out of free trips and climbs away from families', () => {
    expect(clash(cand('Art Museum', 'Art museum', 'museum'), { budget: 'free', party: 'solo' })).toMatch(/charges/)
    expect(clash(cand('City Museum', 'Museum with free admission', 'museum'), { budget: 'free', party: 'solo' })).toBeNull()
    expect(clash(cand('Tower', 'Climb 400 steps to the top', 'viewpoint'), { budget: 'any', party: 'family' })).toMatch(/hard/)
    expect(clash(cand('Tower', 'Climb 400 steps to the top', 'viewpoint'), { budget: 'any', party: 'couple' })).toBeNull()
  })
})

describe('preferencePool', () => {
  const pool = [
    cand('Big Mall', 'Shopping mall', 'other', 9),
    cand('Castle', 'Medieval castle', 'sight', 5),
    cand('Gallery', 'Art gallery', 'museum', 4),
    cand('Station Clock', 'A clock', 'other', 8),
  ]

  it('sends only fitting places when there are enough, best fit first', () => {
    const out = preferencePool(pool, { ...baseRequest, interests: ['history', 'art'] }, 2)
    expect(out.map((c) => c.title)).toEqual(['Castle', 'Gallery'])
  })

  it('tops up with the best of the rest when too few fit', () => {
    const out = preferencePool(pool, { ...baseRequest, interests: ['history'] }, 3)
    expect(out.map((c) => c.title)).toEqual(['Castle', 'Big Mall', 'Station Clock'])
  })
})

describe('preferenceAudit', () => {
  const stop = (id: string, name: string, kind: Stop['kind'], extra: Partial<Stop> = {}): Stop => ({
    id,
    name,
    kind,
    summary: '',
    reason: '',
    photo: null,
    sources: [],
    visitMin: 60,
    arrive: '10:00',
    depart: '11:00',
    mustSee: false,
    lat: 0,
    lon: 0,
    ...extra,
  })

  it('names stops that fit no interest and interests nobody covers', () => {
    const audit = preferenceAudit({ ...baseRequest, interests: ['history', 'parks'] }, [
      { stops: [stop('a', 'Old Castle', 'sight'), stop('b', 'Shoe Shop', 'other'), stop('c', 'Lunch', 'food')], legs: [], audit: [] },
    ])
    expect(audit).toEqual(['Day 1: Shoe Shop (b) matches none of the interests.', 'No stop covers: parks.'])
  })
})

describe('flight between stops', () => {
  it('swings around the target and pulls back, even when the view turns right round', () => {
    const a = stopPose(new Vector3(0, 0, 0), new Vector3(0, 0, 1))
    const b = stopPose(new Vector3(0, 0, 400), new Vector3(0, 0, -1))
    const flight = createFlight(a, b, 0)
    const start = a.position.distanceTo(a.target)
    for (const t of [0.25, 0.5, 0.75]) {
      const p = sampleFlight(flight, t)
      // A straight blend of opposite offsets would put the camera right over the target.
      expect(p.position.distanceTo(p.target)).toBeGreaterThan(start * 1.1)
    }
    const mid = sampleFlight(flight, 0.5)
    expect(mid.position.distanceTo(mid.target)).toBeGreaterThan(start * 1.5)
  })
})

describe('verified tourist tags', async () => {
  const { isAttraction } = await import('../server/upstream/overpass')
  const { osmFame } = await import('../server/pipeline/candidates')
  const { isDestination } = await import('../server/pipeline/places')

  it('accepts sights and rejects everyday places', () => {
    expect(isAttraction({ tourism: 'museum' })).toBe(true)
    expect(isAttraction({ historic: 'castle' })).toBe(true)
    expect(isAttraction({ amenity: 'place_of_worship', building: 'cathedral' })).toBe(true)
    // A parish church or a theatre needs a tourism or heritage tag.
    expect(isAttraction({ amenity: 'place_of_worship' })).toBe(false)
    expect(isAttraction({ amenity: 'theatre', heritage: '2' })).toBe(true)
    expect(isAttraction({ historic: 'memorial_plaque' })).toBe(false)
    expect(isAttraction({ shop: 'books' })).toBe(false)
  })

  it('ranks names in many languages as better known', () => {
    const famous = { tourism: 'attraction', 'name:ja': 'x', 'name:ar': 'x', 'name:de': 'x', 'tourism:visitors': '7000000' }
    expect(osmFame(famous)).toBeGreaterThan(osmFame({ tourism: 'attraction', 'name:de': 'x' }))
  })

  it("keeps a building's dates but still drops people", () => {
    expect(isDestination('Notre-Dame de Paris', 'Cathedral in Paris, France, built 1163–1345')).toBe(true)
    expect(isDestination('Victor Hugo', 'French writer (1802–1885)')).toBe(false)
    expect(isDestination('Paris 1 University', 'Public university in Paris')).toBe(false)
  })
})
