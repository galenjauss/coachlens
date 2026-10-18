import { ThreeCanvas } from '@remotion/three'
import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EASE, lin } from '../lib/anim'

/**
 * A modelled Even G2 (style "A": rounded lenses with a flat top, thin magnesium front, titanium
 * temples with a slim electronics pod near the ear, screwless hinge, adjustable nose pads).
 * Proportions from the published fit sizes: lens 47.7 × 41.3 mm; 1 unit = 10 mm.
 * The display in the right lens is the REAL simulator capture, used as an emissive texture.
 */

const A = 2.385 // lens half-width (units)
const B = 2.065 // lens half-height
const BRIDGE = 0.9 // half bridge (18 mm)
const LX = A + BRIDGE // lens centre x
const RIM = 0.19 // 1.9 mm rim: G2's thin front

/** G2 A lens outline: flat-ish top, rounded bottom, slightly wider at the top (panto feel). */
const outline = (a: number, b: number, n = 96): THREE.Vector2[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const y = s > 0 ? b * Math.abs(s) ** 0.32 * 0.96 : -b * Math.abs(s) ** 0.85
    const taper = 1 + 0.07 * (y / b)
    return new THREE.Vector2(Math.sign(c) * Math.abs(c) ** 0.62 * a * taper, y)
  })

function rimGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline(A + RIM, B + RIM))
  shape.holes.push(new THREE.Path(outline(A, B).reverse()))
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 64 })
  g.translate(0, 0, -0.14)
  return g
}

function lensGeometry(): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline(A + 0.02, B + 0.02)), { depth: 0.12, bevelEnabled: false, curveSegments: 64 })
  g.translate(0, 0, -0.06)
  return g
}

function useEnvironment() {
  const { gl, scene } = useThree()
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    // An opaque studio black (same as the film's black field) so the glass has something to refract
    // and the additive display glow composites correctly.
    scene.background = new THREE.Color('#07090A')
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.05
    return () => {
      scene.environment = null
      scene.background = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
}

function useCaptureTexture(path: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const [handle] = useState(() => delayRender(`G2 display texture ${path}`))
  useLayoutEffect(() => {
    new THREE.TextureLoader().load(
      staticFile(path),
      t => {
        t.colorSpace = THREE.SRGBColorSpace
        t.magFilter = THREE.NearestFilter
        t.anisotropy = 8
        setTex(t)
      },
      undefined,
      () => continueRender(handle),
    )
  }, [path, handle])
  // Release the render only after React has committed the texture, so the canvas draws it.
  useLayoutEffect(() => {
    if (tex) continueRender(handle)
  }, [tex, handle])
  return tex
}

/** Soft contact shadow: a radial-gradient blob (deterministic, no shadow-map flicker). */
function useShadowTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
      g.addColorStop(0, 'rgba(0,0,0,0.75)')
      g.addColorStop(0.5, 'rgba(0,0,0,0.28)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 256, 256)
    }
    return new THREE.CanvasTexture(c)
  }, [])
}

interface SceneProps {
  /** Local frame. */
  f: number
  tex: THREE.Texture | null
  litAt: number
  dollyFrom: number
  dollyTo: number
}

/** Display centre in world units (inside the right lens, upper middle, where G2 projects). */
const DISPLAY: [number, number, number] = [LX, 0.25, 0.1]
const DISPLAY_W = 3.3

function Glasses({ f, tex, litAt, dollyFrom, dollyTo }: SceneProps) {
  useEnvironment()
  const { camera } = useThree()
  const shadow = useShadowTexture()
  const geo = useMemo(() => ({ rim: rimGeometry(), lens: lensGeometry() }), [])
  const mats = useMemo(
    () => ({
      frame: new THREE.MeshPhysicalMaterial({ color: '#2a2d30', metalness: 0.6, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.7 }),
      titanium: new THREE.MeshPhysicalMaterial({ color: '#555a5f', metalness: 0.92, roughness: 0.34, anisotropy: 0.6, envMapIntensity: 1.25 }),
      pod: new THREE.MeshPhysicalMaterial({ color: '#1d1f21', metalness: 0.25, roughness: 0.48, clearcoat: 0.3, envMapIntensity: 0.8 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.05, transmission: 1, ior: 1.5, thickness: 0.25, envMapIntensity: 1.4, transparent: true, opacity: 1, specularIntensity: 1 }),
      pad: new THREE.MeshPhysicalMaterial({ color: '#9aa09c', roughness: 0.25, transmission: 0.6, thickness: 0.2, ior: 1.45 }),
    }),
    [],
  )
  const bridge = useMemo(
    () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-BRIDGE - 0.12, 1.55, 0), new THREE.Vector3(0, 1.72, 0.04), new THREE.Vector3(BRIDGE + 0.12, 1.55, 0)]), 32, 0.11, 16, false),
    [],
  )
  const pod = useMemo(() => new THREE.CapsuleGeometry(0.15, 1.8, 8, 24), [])

  // Turntable: slow reveal, settling face-on before the dolly.
  const spin = EASE.inOut(lin(f, [0, dollyFrom], [0, 1]))
  const rotY = -1.25 + spin * 1.25
  const rotX = 0.16 - spin * 0.16
  // Camera: gentle orbit, then a dolly into the display until it fills the frame.
  const d = EASE.inOut(lin(f, [dollyFrom, dollyTo], [0, 1]))
  // Distance where DISPLAY_W spans 1152 px (the 2× lens shot that follows), and a 0.2-unit vertical
  // offset so the display sits 70 px above centre, exactly where the next shot's capture is.
  const fill = 8.77
  const start = new THREE.Vector3(Math.sin(f * 0.004) * 1.8, 1.6, 40)
  const end = new THREE.Vector3(DISPLAY[0], DISPLAY[1] - 0.095, DISPLAY[2] + fill)
  camera.position.lerpVectors(start, end, d)
  const look = new THREE.Vector3(0, 0, -2).lerp(new THREE.Vector3(DISPLAY[0], DISPLAY[1] - 0.095, DISPLAY[2]), d)
  camera.lookAt(look)
  camera.updateProjectionMatrix()

  const lit = lin(f, [litAt, litAt + 10], [0, 1])
  const sweep = lin(f, [0, dollyFrom], [-14, 14])

  return (
    <>
      <ambientLight intensity={0.08} />
      <directionalLight position={[6, 8, 10]} intensity={1.6} color="#fff6ea" />
      <directionalLight position={[sweep, 4, -8]} intensity={5.5} color="#dfe8ff" />
      <directionalLight position={[0, 12, 2]} intensity={0.9} color="#ffffff" />
      <directionalLight position={[-9, -2, 6]} intensity={0.35} color="#9fb4c8" />
      <pointLight position={[DISPLAY[0], DISPLAY[1] - 2.6, -0.6]} intensity={lit * 1.6} distance={5} color="#3DFF7A" />
      <mesh position={[0, -3.6, -5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[22, 14]} />
        <meshBasicMaterial map={shadow} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <group rotation={[rotX, rotY, 0]} position={[5 * Math.sin(rotY), 0, 0]}>
        {[-1, 1].map(side => (
          <group key={side} position={[side * LX, 0, 0]}>
            <mesh geometry={geo.rim} material={mats.frame} />
            <mesh geometry={geo.lens} material={mats.glass} />
            <mesh position={[side * -1.62, -0.55, -0.5]} scale={[0.16, 0.28, 0.08]} material={mats.pad}>
              <sphereGeometry args={[1, 24, 16]} />
            </mesh>
          </group>
        ))}
        <mesh geometry={bridge} material={mats.frame} />
        {[-1, 1].map(side => {
          const x = side * (LX + A + RIM + 0.12)
          return (
            <group key={`t${side}`} position={[x, 0, -0.6]} rotation={[0, side * 0.09, 0]}>
              <group position={[-x, 0, 0.6]}>
              {/* end piece and screwless hinge */}
              <mesh position={[x, 1.25, -0.25]} material={mats.frame}>
                <boxGeometry args={[0.36, 0.62, 0.62]} />
              </mesh>
              <mesh position={[x, 1.25, -0.6]} rotation={[0, 0, 0]} material={mats.titanium}>
                <cylinderGeometry args={[0.09, 0.09, 0.66, 16]} />
              </mesh>
              {/* titanium temple */}
              <mesh position={[x, 1.24, -6.3]} material={mats.titanium}>
                <boxGeometry args={[0.13, 0.3, 11.4]} />
              </mesh>
              {/* electronics pod near the ear */}
              <mesh position={[x + side * 0.02, 1.2, -10.4]} rotation={[Math.PI / 2, 0, 0]} scale={[0.85, 1, 1.5]} material={mats.pod}>
                <primitive object={pod} attach="geometry" />
              </mesh>
              {/* tip, curving down */}
              <mesh position={[x, 0.55, -12.75]} rotation={[-0.75, 0, 0]} material={mats.pod}>
                <boxGeometry args={[0.15, 0.32, 1.9]} />
              </mesh>
              </group>
            </group>
          )
        })}
        {tex ? (
          <group position={DISPLAY}>
            <mesh>
              <planeGeometry args={[DISPLAY_W, DISPLAY_W / 2]} />
              <meshBasicMaterial map={tex} transparent opacity={lit} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        ) : null}
      </group>
    </>
  )
}

interface G2ModelProps {
  width: number
  height: number
  display: string
  litAt: number
  dollyFrom: number
  dollyTo: number
}

/** The 3D G2 product shot. All animation is driven by useCurrentFrame (no useFrame). */
export function G2Model({ width, height, display, litAt, dollyFrom, dollyTo }: G2ModelProps) {
  const f = useCurrentFrame()
  const tex = useCaptureTexture(display)
  if (!tex) return null
  return (
    <ThreeCanvas width={width} height={height} gl={{ antialias: true, alpha: true }} dpr={1.5} camera={{ fov: 20, near: 0.1, far: 200, position: [0, 1.6, 40] }}>
      <Glasses f={f} tex={tex} litAt={litAt} dollyFrom={dollyFrom} dollyTo={dollyTo} />
    </ThreeCanvas>
  )
}
