import type { StopKind, TripRequest } from '../../src/lib/types.js'
import type { Candidate } from './context.js'
import { plain } from './places.js'

// Preference rules (code): which interests a place matches, and which places
// clash with the budget or the party. The Scout only sees places that fit, as
// long as enough of them exist, so the plan follows the form closely.

const INTEREST_RULES: Record<string, RegExp> = {
  art: /\b(art|arts|gallery|galleries|painting|paintings|sculpture|mural|street art|fine arts|modern art|contemporary art)\b/,
  history: /\b(histor\w*|ancient|medieval|roman|ruins?|castle|fort|fortress|palace|monument|memorial|archaeolog\w*|heritage|old town|citadel|walls|unesco)\b/,
  architecture: /\b(architect\w*|cathedral|basilica|palace|tower|bridge|gothic|baroque|renaissance|art nouveau|art deco|modernis[tm]|skyscraper|facade|castle|mosque|temple|landmark building)\b/,
  museums: /\b(museum|museums|musee|museo|gallery|exhibition|planetarium|aquarium|science cent(er|re))\b/,
  parks: /\b(park|parks|garden|gardens|jardin|botanical|zoo|forest|woods|lake|beach|promenade|green space)\b/,
  views: /\b(viewpoint|lookout|observation|belvedere|miradouro|tower|hill|summit|panoram\w*|skyscraper|observatory|funicular|cable car|ferris wheel)\b/,
  markets: /\b(market|markets|marche|mercado|bazaar|souk|food hall|flea)\b/,
  churches: /\b(church|cathedral|basilica|chapel|abbey|monastery|convent|mosque|synagogue|temple|shrine|priory)\b/,
  music: /\b(opera|concert|music|philharmonic|symphony|jazz|conservatory|auditorium|theatre|theater|concert hall)\b/,
  shopping: /\b(shopping|shops|mall|arcade|department store|boutiques?|bazaar|market|galleria|high street)\b/,
  food: /\b(market|food|gastronom\w*|culinary|wine|winery|brewery|chocolate|cheese|food hall|tea)\b/,
  nightlife: /\b(nightlife|night|club|cabaret|casino|entertainment|bar district|live music|theatre|theater)\b/,
}

/** Kinds that count for an interest even when the words do not say so. */
const KIND_INTERESTS: Partial<Record<StopKind, string[]>> = {
  museum: ['museums'],
  park: ['parks'],
  viewpoint: ['views'],
  market: ['markets', 'shopping', 'food'],
}

function ruleFor(interest: string): RegExp {
  const known = INTEREST_RULES[interest.toLowerCase()]
  if (known) return known
  // A free-text interest ("photography") matches its own word.
  const word = plain(interest).replace(/[^a-z0-9 ]/g, '').trim()
  return word ? new RegExp(`\\b${word}`) : /$^/
}

/** The traveller's interests this place matches, from its kind, title and description. */
export function interestsMatched(
  place: { title: string; description: string; kind: StopKind; osmType?: string },
  interests: string[],
): string[] {
  const text = plain(`${place.title} ${place.description} ${place.osmType ?? ''}`)
  const byKind = KIND_INTERESTS[place.kind] ?? []
  return interests.filter((i) => byKind.includes(i.toLowerCase()) || ruleFor(i).test(text))
}

/** Places that usually charge for entry. */
const PAID = /\b(museum|gallery|aquarium|zoo|planetarium|theme park|amusement park|observation deck|wax|escape|cable car|ferris wheel)\b/
const FREE = /\b(free (admission|entry|entrance)|no admission)\b/
/** Places that are hard going for small children or anyone taking it easy. */
const TOUGH = /\b(climb|climbing|steps|stairs|summit|hike|hiking|trail|mountain|crag|cliff|catacombs?|nightclub|red light)\b/
/** Places families tend to enjoy. */
const FAMILY = /\b(zoo|aquarium|playground|science|natural history|toy|park|garden|beach|planetarium|castle|children)\b/

/** Why a place clashes with the budget or the party, or null when it fits. */
export function clash(
  place: { title: string; description: string; kind: StopKind; osmType?: string },
  request: Pick<TripRequest, 'budget' | 'party'>,
): string | null {
  const text = plain(`${place.title} ${place.description} ${place.osmType ?? ''}`)
  if (request.budget === 'free' && (place.kind === 'museum' || PAID.test(text)) && !FREE.test(text)) return 'usually charges for entry'
  if ((request.party === 'family' || request.party === 'easy') && TOUGH.test(text)) return 'hard going for this group'
  return null
}

export type RankedCandidate = Candidate & { fits: string[] }

/**
 * The pool the Scout chooses from, best fit first. Places that clash with the
 * budget or party are left out, and so are places that match no interest,
 * unless that would leave fewer than `wanted` places.
 */
export function preferencePool(pool: Candidate[], request: TripRequest, wanted: number): RankedCandidate[] {
  const ranked = pool.map((c) => ({ ...c, fits: interestsMatched(c, request.interests) }))
  const bonus = (c: RankedCandidate) =>
    c.fits.length * 2 + (request.party === 'family' && FAMILY.test(plain(`${c.title} ${c.description}`)) ? 1 : 0)
  ranked.sort((a, b) => bonus(b) - bonus(a) || b.score - a.score)

  const noClash = ranked.filter((c) => !clash(c, request))
  const base = noClash.length >= wanted ? noClash : ranked
  if (request.interests.length === 0) return base
  const fitting = base.filter((c) => c.fits.length > 0)
  if (fitting.length >= wanted) return fitting
  // Not enough fitting places: top up with the best of the rest (already sorted after them).
  return [...fitting, ...base.filter((c) => c.fits.length === 0).slice(0, wanted - fitting.length)]
}
