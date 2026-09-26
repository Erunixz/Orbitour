import { lazy, Suspense, useCallback, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Budget, Meal, Pace, Party, TravelMode, TripRequest } from '../lib/types'
import { ErrorBoundary } from '../ErrorBoundary'
import { coordsFor, CITY_COORDS, EXAMPLES, POPULAR_CITIES, useWikiPhoto, type Example } from './examples'
import { SavedTrips } from './SavedTrips'

// Home: a globe, example trips to start from, and the form to describe the trip.
// City names are suggested from a built-in list; the server looks the city up
// once, when planning starts.

const Globe = lazy(() => import('./Globe'))

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
}

const today = () => new Date().toISOString().slice(0, 10)

export function Home({ initial, onPlan }: Props) {
  const [form, setForm] = useState<TripRequest>(initial)
  const [mustSeeText, setMustSeeText] = useState(initial.mustSee.join('\n'))
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [globeReady, setGlobeReady] = useState(false)
  const markGlobeReady = useCallback(() => setGlobeReady(true), [])
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

  const focus = coordsFor(form.city)
  const markers = useMemo(
    () => EXAMPLES.map((e) => ({ id: e.id, label: e.request.city, ...CITY_COORDS[e.request.city]! })),
    [],
  )

  const applyExample = (example: Example) => {
    setForm({ ...defaultRequest, ...form, startFrom: undefined, diet: undefined, ...example.request, mustSee: [] })
    setMustSeeText('')
    setError(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-text">
          <p className="brand">Orbitour</p>
          <h1>Plan a trip, then fly through it in 3D</h1>
          <p className="hero-lead">
            Name a city and say what you like. A crew of code tools and two AI agents builds a day-by-day plan on real
            streets, and you explore it stop by stop over a photorealistic city.
          </p>
          <div className="hero-actions">
            <button type="button" className="plan-button" onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth' })}>
              Start planning
            </button>
          </div>
          <p className="hero-place" aria-live="polite">
            {focus ? `Heading to ${focus.label}` : 'Drag the globe, or pick a glowing city'}
          </p>
        </div>
        <div className="hero-globe">
          {!globeReady && <div className="globe-fallback" />}
          <ErrorBoundary name="globe" fallback={() => null}>
            <Suspense fallback={null}>
              <Globe
                onReady={markGlobeReady}
                markers={markers}
                focus={focus}
                onPick={(id) => {
                  const example = EXAMPLES.find((e) => e.id === id)
                  if (example) applyExample(example)
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </section>

      <section className="home-section" aria-labelledby="examples-title">
        <h2 id="examples-title">Start from an example</h2>
        <p className="muted">Pick one to fill in the form, then change anything you like.</p>
        <ul className="examples">
          {EXAMPLES.map((example) => (
            <li key={example.id}>
              <ExampleCard example={example} active={form.city === example.request.city} onUse={() => applyExample(example)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section steps" aria-label="How it works">
        <Step n={1} title="Describe it">
          City, days, pace, budget and what you love. Your choices are strict rules for the plan.
        </Step>
        <Step n={2} title="The crew plans">
          Real places from Wikipedia and OpenStreetMap, checked, timed and routed in code.
        </Step>
        <Step n={3} title="Fly through it">
          Next and Back glide the camera over the city from stop to stop.
        </Step>
      </section>

      <h2 className="form-title">Your trip</h2>
      <form ref={formRef} className="card plan-form" onSubmit={submit} noValidate>
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
        <a href="/status">Server status</a>
        <br />
        Globe imagery: NASA Blue Marble. Photos: Wikipedia.
      </p>
    </main>
  )
}

function ExampleCard({ example, active, onUse }: { example: Example; active: boolean; onUse: () => void }) {
  const photo = useWikiPhoto(example.photoArticle)
  const [broken, setBroken] = useState(false)
  const { request } = example
  return (
    <button type="button" className={`example${active ? ' active' : ''}`} onClick={onUse}>
      <span className="example-photo">
        {photo && (
          <img
            src={broken ? photo.fallback : photo.url}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        )}
        <span className="example-city">{request.city}</span>
      </span>
      <span className="example-body">
        <span className="example-title">{example.title}</span>
        <span className="example-blurb">{example.blurb}</span>
        <span className="example-tags">
          {request.interests?.map((i) => (
            <span key={i} className="tag">
              {i}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="step">
      <span className="step-n">{n}</span>
      <h3>{title}</h3>
      <p className="muted">{children}</p>
    </div>
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
