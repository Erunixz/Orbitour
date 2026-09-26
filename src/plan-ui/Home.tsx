import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { Budget, Meal, Pace, Party, TravelMode, TripRequest } from '../lib/types'
import { SavedTrips } from './SavedTrips'

// Home: describe the trip. City names are suggested from a built-in list;
// the server looks the city up once, when planning starts.

const POPULAR_CITIES = [
  'Amsterdam', 'Athens', 'Bangkok', 'Barcelona', 'Berlin', 'Boston', 'Budapest', 'Buenos Aires', 'Cape Town',
  'Chicago', 'Copenhagen', 'Dubai', 'Dublin', 'Edinburgh', 'Florence', 'Hong Kong', 'Istanbul', 'Kyoto', 'Lisbon',
  'London', 'Los Angeles', 'Madrid', 'Melbourne', 'Mexico City', 'Montreal', 'Munich', 'New York', 'Paris', 'Prague',
  'Rio de Janeiro', 'Rome', 'San Francisco', 'Seoul', 'Singapore', 'Stockholm', 'Sydney', 'Tokyo', 'Toronto',
  'Venice', 'Vienna',
]

const INTERESTS = ['art', 'history', 'architecture', 'museums', 'parks', 'views', 'markets', 'churches', 'music', 'shopping', 'food', 'nightlife']

export const defaultRequest: TripRequest = {
  city: '',
  days: 2,
  startTime: '09:30',
  endTime: '18:00',
  mustSee: [],
  interests: ['history', 'architecture'],
  pace: 'normal',
  mode: 'auto',
  party: 'couple',
  budget: 'modest',
  meals: ['lunch'],
}

type Props = {
  initial: TripRequest
  onPlan: (request: TripRequest) => void
  /** Link to open the sample trip without planning. */
  sampleHref: string
}

const today = () => new Date().toISOString().slice(0, 10)

export function Home({ initial, onPlan, sampleHref }: Props) {
  const [form, setForm] = useState<TripRequest>(initial)
  const [mustSeeText, setMustSeeText] = useState(initial.mustSee.join('\n'))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof TripRequest>(key: K, value: TripRequest[K]) => setForm((f) => ({ ...f, [key]: value }))

  const toggle = <T extends string>(list: T[], item: T) => (list.includes(item) ? list.filter((i) => i !== item) : [...list, item])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const city = form.city.trim()
    const mustSee = mustSeeText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!city) return setError('Enter a city.')
    if (form.startTime >= form.endTime) return setError('The day must end after it starts.')
    if (mustSee.length > 10) return setError('Up to 10 must-see places, please.')
    setError(null)
    const request: TripRequest = { ...form, city, mustSee }
    if (!request.startFrom?.trim()) delete request.startFrom
    if (!request.diet?.trim()) delete request.diet
    if (!request.startDate) delete request.startDate
    onPlan(request)
  }

  return (
    <main className="home">
      <header className="home-header">
        <p className="brand">Orbitour</p>
        <h1>Plan a trip on a 3D map</h1>
        <p className="muted">
          Name a city and say what you like. A crew of code tools and two AI agents builds a day-by-day plan on real
          streets, which you explore one stop at a time.
        </p>
      </header>

      <form className="card plan-form" onSubmit={submit} noValidate>
        <Field label="City">
          {(id) => (
            <>
              <input
                id={id}
                list={`${id}-cities`}
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="For example Lisbon"
                autoComplete="off"
                required
              />
              <datalist id={`${id}-cities`}>
                {POPULAR_CITIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <div className="form-row">
          <Field label="Days">
            {(id) => (
              <select id={id} value={form.days} onChange={(e) => set('days', Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Start date (optional)" hint="Adds dates and a weather check.">
            {(id) => (
              <input
                id={id}
                type="date"
                min={today()}
                value={form.startDate ?? ''}
                onChange={(e) => set('startDate', e.target.value || undefined)}
              />
            )}
          </Field>
        </div>

        <div className="form-row">
          <Field label="Day starts">
            {(id) => <input id={id} type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />}
          </Field>
          <Field label="Day ends">
            {(id) => <input id={id} type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />}
          </Field>
        </div>

        <div className="form-row">
          <Choice<Pace>
            label="Pace"
            value={form.pace}
            onChange={(v) => set('pace', v)}
            options={[
              ['relaxed', 'Relaxed'],
              ['normal', 'Normal'],
              ['packed', 'Packed'],
            ]}
          />
          <Choice<TravelMode | 'auto'>
            label="Getting around"
            value={form.mode}
            onChange={(v) => set('mode', v)}
            options={[
              ['auto', 'Best for each hop'],
              ['walk', 'Walk'],
              ['transit', 'Public transport'],
              ['cycle', 'Bike'],
              ['drive', 'Car'],
            ]}
          />
        </div>

        <div className="form-row">
          <Choice<Party>
            label="Who's going"
            value={form.party}
            onChange={(v) => set('party', v)}
            options={[
              ['solo', 'Just me'],
              ['couple', 'Two of us'],
              ['family', 'Family with kids'],
              ['easy', 'Taking it easy'],
            ]}
          />
          <Choice<Budget>
            label="Budget"
            value={form.budget}
            onChange={(v) => set('budget', v)}
            options={[
              ['free', 'Free things'],
              ['modest', 'Modest'],
              ['any', 'Any'],
            ]}
          />
        </div>

        <fieldset className="chips">
          <legend>Interests</legend>
          {INTERESTS.map((interest) => (
            <label key={interest} className="chip">
              <input
                type="checkbox"
                checked={form.interests.includes(interest)}
                onChange={() => set('interests', toggle(form.interests, interest))}
              />
              {interest}
            </label>
          ))}
        </fieldset>

        <fieldset className="chips">
          <legend>Meals</legend>
          {(['lunch', 'dinner'] as Meal[]).map((meal) => (
            <label key={meal} className="chip">
              <input type="checkbox" checked={form.meals.includes(meal)} onChange={() => set('meals', toggle(form.meals, meal))} />
              {meal}
            </label>
          ))}
        </fieldset>

        <Field label="Diet (optional)">
          {(id) => (
            <input id={id} value={form.diet ?? ''} onChange={(e) => set('diet', e.target.value)} placeholder="For example vegetarian" />
          )}
        </Field>

        <Field label="Must-see places (optional)" hint="One per line.">
          {(id) => (
            <textarea id={id} rows={3} value={mustSeeText} onChange={(e) => setMustSeeText(e.target.value)} placeholder={'Belem Tower\nLX Factory'} />
          )}
        </Field>

        <Field label="Starting from (optional)" hint="Your hotel or a station.">
          {(id) => <input id={id} value={form.startFrom ?? ''} onChange={(e) => set('startFrom', e.target.value)} />}
        </Field>

        {error && (
          <p className="error-inline" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="plan-button">
          Plan my trip
        </button>
      </form>

      <SavedTrips />

      <p className="muted home-foot">
        Want a look first? <a href={sampleHref}>Open a sample trip</a>. <a href="/status">Server status</a>
      </p>
    </main>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: [T, string][]
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}
