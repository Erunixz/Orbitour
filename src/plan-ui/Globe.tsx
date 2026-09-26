import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Line,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Group,
  type Mesh,
  type Points,
} from 'three'
import type { LatLon } from '../lib/types'

// Home page globe: day and night sides with city lights, drifting clouds, and
// flight arcs between the example cities. It always moves: it spins when idle,
// keeps momentum after a drag, and sways gently around a chosen city. Loaded
// lazily so the form shows before three.js arrives.

export type GlobeMarker = LatLon & { id: string; label: string }

type Props = {
  markers: GlobeMarker[]
  /** City to turn towards, or null to keep spinning. */
  focus: (LatLon & { label: string }) | null
  onPick?: (id: string) => void
  /** Called once the textures are in and the globe is drawn. */
  onReady?: () => void
}

const DEG = Math.PI / 180
const SPIN_DEG_PER_S = 7
/** Tilt used while spinning freely, so the busy northern half faces the viewer. */
const IDLE_LAT = 22
/** Sun direction in world space: from the left, so city lights show on the night side at the right. */
const SUN = new Vector3(-0.92, 0.28, 0.24).normalize()

/** Point on the sphere for three's SphereGeometry texture layout. */
function onSphere({ lat, lon }: LatLon, r = 1): Vector3 {
  return new Vector3(r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.sin(lat * DEG), -r * Math.cos(lat * DEG) * Math.sin(lon * DEG))
}

/** Shortest way from angle a to b, in degrees. */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180

export default function Globe(props: Props) {
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  return (
    <Canvas className="globe-canvas" camera={{ position: [0, 0, 3.25], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.05} />
      <directionalLight position={SUN.clone().multiplyScalar(5)} intensity={2.4} />
      <Stars reduced={reduced} />
      <Earth {...props} reduced={reduced} />
    </Canvas>
  )
}

function Earth({ markers, focus, onPick, onReady, reduced }: Props & { reduced: boolean }) {
  const [day, night, water, clouds] = useLoader(TextureLoader, [
    '/globe/earth.jpg',
    '/globe/earth-night.jpg',
    '/globe/earth-water.jpg',
    '/globe/clouds.jpg',
  ])
  day!.colorSpace = SRGBColorSpace
  night!.colorSpace = SRGBColorSpace

  const tilt = useRef<Group>(null)
  const spin = useRef<Group>(null)
  const cloudLayer = useRef<Mesh>(null)
  const gl = useThree((s) => s.gl)

  // Current and wanted view, as the lat/lon facing the camera, plus drag momentum.
  const view = useRef({ lat: IDLE_LAT, lon: focus?.lon ?? 10 })
  const goal = useRef({ lat: IDLE_LAT, lon: focus?.lon ?? 10 })
  const velocity = useRef(0)
  const drag = useRef<{ x: number; y: number; t: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Textures are loaded once this component renders (useLoader suspends until then).
  useEffect(() => {
    onReady?.()
  }, [onReady])

  useEffect(() => {
    if (focus) goal.current = { lat: focus.lat * 0.75, lon: focus.lon }
    else goal.current.lat = IDLE_LAT
  }, [focus])

  // Drag anywhere on the canvas to turn the globe. Letting go keeps the spin going.
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      velocity.current = 0
      setDragging(true)
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const now = performance.now()
      const dx = e.clientX - drag.current.x
      const dy = e.clientY - drag.current.y
      const perPx = 180 / el.clientWidth
      goal.current.lon -= dx * perPx
      goal.current.lat = Math.max(-60, Math.min(70, goal.current.lat + dy * perPx))
      view.current = { ...goal.current }
      velocity.current = (-dx * perPx) / Math.max(0.008, (now - drag.current.t) / 1000)
      drag.current = { x: e.clientX, y: e.clientY, t: now }
    }
    const up = () => {
      drag.current = null
      setDragging(false)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [gl])

  useEffect(() => {
    gl.domElement.style.cursor = dragging ? 'grabbing' : 'grab'
  }, [gl, dragging])

  const earthMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { dayMap: { value: day }, nightMap: { value: night }, waterMap: { value: water }, sunDir: { value: SUN } },
        vertexShader: EARTH_VERTEX,
        fragmentShader: EARTH_FRAGMENT,
      }),
    [day, night, water],
  )

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1)
    if (!drag.current && !reduced) {
      if (Math.abs(velocity.current) > 0.5) {
        // Momentum from a flick, fading out.
        goal.current.lon += velocity.current * dt
        velocity.current *= Math.exp(-dt * 2.5)
      } else if (focus) {
        // Sway around the chosen city so it never looks frozen.
        goal.current.lon = focus.lon + Math.sin(clock.elapsedTime * 0.5) * 7
      } else {
        goal.current.lon += SPIN_DEG_PER_S * dt
      }
    }
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3.5)
    view.current.lon += turn(view.current.lon, goal.current.lon) * k
    view.current.lat += (goal.current.lat - view.current.lat) * k
    if (tilt.current) tilt.current.rotation.x = view.current.lat * DEG
    if (spin.current) spin.current.rotation.y = -Math.PI / 2 - view.current.lon * DEG
    if (cloudLayer.current && !reduced) cloudLayer.current.rotation.y += dt * 0.012
  })

  const arcs = useMemo(() => {
    const out: [GlobeMarker, GlobeMarker][] = []
    for (let i = 0; i < markers.length; i++) out.push([markers[i]!, markers[(i + 1) % markers.length]!])
    if (markers.length > 3) out.push([markers[0]!, markers[Math.floor(markers.length / 2)]!])
    return out
  }, [markers])

  return (
    <group ref={tilt}>
      <group ref={spin}>
        <mesh material={earthMaterial}>
          <sphereGeometry args={[1, 128, 96]} />
        </mesh>
        <mesh ref={cloudLayer} scale={1.012}>
          <sphereGeometry args={[1, 96, 64]} />
          <meshPhongMaterial color="#ffffff" specular="#000000" alphaMap={clouds} transparent opacity={0.85} depthWrite={false} />
        </mesh>
        {arcs.map(([a, b], i) => (
          <Arc key={`${a.id}-${b.id}`} from={a} to={b} offset={i / arcs.length} reduced={reduced} />
        ))}
        {markers.map((m) => (
          <Marker key={m.id} marker={m} active={focus?.label === m.label} onPick={onPick} />
        ))}
        {focus && !markers.some((m) => m.label === focus.label) && <Marker marker={{ ...focus, id: 'focus' }} active onPick={undefined} />}
      </group>
      <Atmosphere />
    </group>
  )
}

const EARTH_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`

const EARTH_FRAGMENT = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D waterMap;
uniform vec3 sunDir;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 viewDir = normalize(cameraPosition - vPosW);
  float d = dot(n, sunDir);
  float dayMix = smoothstep(-0.12, 0.22, d);
  vec3 dayColor = texture2D(dayMap, vUv).rgb * (0.25 + 1.1 * max(d, 0.0));
  // Keep the bright city lights and drop the faint land in the night picture.
  vec3 lights = texture2D(nightMap, vUv).rgb;
  vec3 nightColor = pow(lights, vec3(2.2)) * vec3(3.2, 2.4, 1.4) + vec3(0.003, 0.007, 0.018);
  vec3 color = mix(nightColor, dayColor, dayMix);
  float water = texture2D(waterMap, vUv).r;
  vec3 h = normalize(sunDir + viewDir);
  color += vec3(0.55, 0.7, 1.0) * pow(max(dot(n, h), 0.0), 140.0) * water * dayMix * 0.45;
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  color += vec3(0.3, 0.6, 1.0) * rim * (0.15 + 0.45 * dayMix);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`

/** A glowing great-circle arc with a light running along it. */
function Arc({ from, to, offset, reduced }: { from: LatLon; to: LatLon; offset: number; reduced: boolean }) {
  const line = useMemo(() => {
    const a = onSphere(from)
    const b = onSphere(to)
    const angle = a.angleTo(b)
    const lift = 0.04 + angle * 0.08
    const q = new Quaternion()
    const axis = new Vector3().crossVectors(a, b).normalize()
    const points: number[] = []
    const ts: number[] = []
    const steps = 80
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const p = a.clone().applyQuaternion(q.setFromAxisAngle(axis, angle * t)).multiplyScalar(1.01 + lift * Math.sin(Math.PI * t))
      points.push(p.x, p.y, p.z)
      ts.push(t)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
    geometry.setAttribute('aT', new Float32BufferAttribute(ts, 1))
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: offset * 4 }, uColor: { value: new Color('#ffd166') } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: `attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying float vT;
void main() {
  float head = fract(uTime * 0.22);
  float behind = head - vT;
  float glow = behind > 0.0 && behind < 0.3 ? 1.0 - behind / 0.3 : 0.0;
  gl_FragColor = vec4(uColor, max(glow, 0.14));
}`,
    })
    return new Line(geometry, material)
  }, [from, to, offset])

  useFrame((_, delta) => {
    if (!reduced) (line.material as ShaderMaterial).uniforms.uTime!.value += delta
  })
  return <primitive object={line} />
}

function Marker({ marker, active, onPick }: { marker: GlobeMarker; active: boolean; onPick: Props['onPick'] }) {
  const ring = useRef<Mesh>(null)
  const pos = useMemo(() => onSphere(marker, 1.004), [marker])
  // Lay the dot flat on the surface: its face points out from the center.
  const facing = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), pos.clone().normalize().negate()), [pos])
  const [hover, setHover] = useState(false)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const t = (clock.elapsedTime * 0.7 + marker.lat) % 1
    ring.current.scale.setScalar(1 + t * (active ? 2.6 : 1.6))
    ;(ring.current.material as { opacity: number }).opacity = (active ? 0.85 : 0.5) * (1 - t)
  })
  const size = active ? 0.022 : hover ? 0.019 : 0.013
  const color = active ? '#ffd166' : '#8fd3ff'
  return (
    <group position={pos} quaternion={facing}>
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          onPick?.(marker.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
      >
        <circleGeometry args={[size, 24]} />
        <meshBasicMaterial color={color} side={BackSide} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[size, size * 1.35, 32]} />
        <meshBasicMaterial color={color} transparent side={BackSide} depthWrite={false} />
      </mesh>
      {(active || hover) && (
        <Html center position={[0, 0, -0.07]} className="globe-label" zIndexRange={[5, 0]}>
          {marker.label}
        </Html>
      )}
    </group>
  )
}

/** Soft blue edge glow. */
function Atmosphere() {
  return (
    <mesh scale={1.16}>
      <sphereGeometry args={[1, 64, 48]} />
      <shaderMaterial
        side={BackSide}
        blending={AdditiveBlending}
        transparent
        depthWrite={false}
        vertexShader={`varying vec3 vNormal;
void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`varying vec3 vNormal;
void main() { float i = pow(0.74 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2); gl_FragColor = vec4(0.35, 0.65, 1.0, 1.0) * i * 0.95; }`}
      />
    </mesh>
  )
}

function Stars({ reduced }: { reduced: boolean }) {
  const ref = useRef<Points>(null)
  const geometry = useMemo(() => {
    const points: number[] = []
    // Fixed seed so the sky looks the same on every visit.
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 1400; i++) {
      const u = rand() * 2 - 1
      const a = rand() * Math.PI * 2
      const r = 12 + rand() * 8
      const s = Math.sqrt(1 - u * u)
      points.push(r * s * Math.cos(a), r * u, r * s * Math.sin(a) - 6)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(points, 3))
    return g
  }, [])
  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.y += delta * 0.01
  })
  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={0.05} color="#cfe3ff" transparent opacity={0.85} sizeAttenuation />
    </points>
  )
}
