import type { StopKind } from '../../src/lib/types.js'

// Rules for telling real destinations apart from other things that have a
// Wikipedia page with coordinates (streets, stations, companies, people, events).

const NOT_DESTINATION = [
  // Only when the description is about the street or area itself ("Street in Paris",
  // "Historic district of Rome"), not a sight inside one ("Church in the 4th arrondissement").
  /^([\w-]+ ){0,2}(street|avenue|boulevard|road|lane|alley|highway|motorway|quay|embankment)\b/,
  /^([\w-]+ ){0,2}(district|arrondissement|neighbou?rhood|quarter|borough|ward|parish|commune|municipality|suburb|constituency)\b/,
  // The city, town or region itself ("Capital and largest city of Portugal"), but not a city hall.
  /^([\w-]+ ){0,1}(capital|city|town|village|country|region|province|county|island|metropolis)\b(?! hall)/,
  /\b(railway|metro|subway|underground|tram|bus|train) station\b/,
  /\bstation (in|on|of)\b/,
  /\b(company|corporation|brand|manufacturer|retailer|bank|airline|publisher|newspaper|magazine|agency|ministry|embassy|consulate)\b/,
  /\b(police|gendarmerie|army|navy|regiment|military unit|court|legislature|government|governing body|federation|political party|organi[sz]ation|association|sports club|football club|team)\b/,
  /\b(footballer|politician|actor|actress|singer|writer|painter|architect|businessman|businesswoman|journalist|musician|athlete|player|born)\b/,
  /\b(festival|battle|siege|riot|attack|bombing|shooting|protest|election|treaty|event|competition|tournament|race)\b/,
  /\b(accident|derailment|disaster|crash|collapse|earthquake|explosion|massacre|shipwreck|incident|murder)\b/,
  /\b(school|college|lycee|hospital|clinic|prison|headquarters|office building|apartment|residential|car park|parking)\b/,
  /\b(album|song|film|novel|television|tv series|video game|band)\b/,
]

/** Lowercase without accents, so word boundaries work on "Café" or "Musée". */
const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// Events are usually titled with their year first, like "2025 ... derailment".
const NOT_DESTINATION_TITLE = [/^list of /i, /^(history|geography|culture|timeline) of /i, /\bstation$/i, /^\d{4} /]

/** True for places worth visiting: sights, museums, parks and so on. */
export function isDestination(title: string, description: string): boolean {
  if (NOT_DESTINATION_TITLE.some((re) => re.test(title))) return false
  const text = plain(description)
  if (!text) return true
  // People and past organisations carry a year range, like "(1802–1885)" or "1933–1969 secret police".
  if (/\b\d{3,4}\s*[-–]\s*\d{2,4}\b/.test(text) || /\bborn \d{3,4}\b/.test(text)) return false
  return !NOT_DESTINATION.some((re) => re.test(text))
}

const KIND_RULES: [StopKind, RegExp][] = [
  ['museum', /\b(museum|gallery|musee|exhibition|art cent(er|re)|planetarium|aquarium)\b/],
  ['park', /\b(park|garden|gardens|jardin|zoo|botanical|cemetery|forest|woods|lake|beach|square garden)\b/],
  ['market', /\b(market|marche|bazaar|souk|shopping arcade|arcade)\b/],
  ['viewpoint', /\b(tower|viewpoint|observation|lookout|belvedere|hill|summit|skyscraper|observatory|elevator|lift|funicular)\b/],
  ['food', /\b(restaurant|cafe|coffeehouse|bistro|brasserie|bakery|tea house|bar)\b/],
  [
    'sight',
    /\b(church|cathedral|basilica|chapel|abbey|mosque|synagogue|temple|shrine|palace|castle|fort|monument|memorial|statue|fountain|bridge|arch|gate|opera|theatre|theater|building|landmark|hall|house|square|plaza|place)\b/,
  ],
]

/** Best guess of the kind of stop from its title and short description. */
export function guessKind(title: string, description: string): StopKind {
  const text = plain(`${description} ${title}`)
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind
  return 'other'
}

/** Kind from OSM tags, for places found through Nominatim. */
export function kindFromOsm(category: string, type: string): StopKind {
  if (type === 'museum' || type === 'gallery') return 'museum'
  if (['park', 'garden', 'nature_reserve', 'zoo'].includes(type)) return 'park'
  if (type === 'marketplace') return 'market'
  if (type === 'viewpoint' || type === 'tower') return 'viewpoint'
  if (['restaurant', 'cafe', 'bar', 'pub'].includes(type)) return 'food'
  if (['hotel', 'guest_house', 'hostel'].includes(type)) return 'lodging'
  if (['tourism', 'historic', 'amenity', 'building', 'man_made'].includes(category)) return 'sight'
  return 'other'
}

/** "Museum in Paris" style summary for a place that has no article. Written from data, not by the LLM. */
export function osmSummary(type: string, displayName: string): string {
  const label = type ? type.replace(/_/g, ' ') : 'place'
  // Skip house numbers so "Hotel, 123, Rua X, Lisbon" reads "Hotel in Rua X, Lisbon".
  const area = displayName
    .split(',')
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s && !/^\d+[a-z]?$/i.test(s))
    .slice(0, 2)
    .join(', ')
  const text = area ? `${label} in ${area}.` : `${label}.`
  return text.charAt(0).toUpperCase() + text.slice(1)
}
