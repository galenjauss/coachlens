import { ThreeCanvas } from '@remotion/three'
import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { EASE, lin } from '../lib/anim'
import {
  BRIDGE, HINGE_X, LX, bridgeCurve, endPieceCurve, endPieceSection, lensGeometry, padArmCurve, rimGeometry, roughnessNoise, sweep,
  templeCurve, templeSection, waveguideGeometry,
} from './g2Geometry'

/**
 * A modelled Even G2 (style A, graphite): thin magnesium front with a keyhole bridge and pad arms,
 * lofted end pieces that house the optics, a screwless hinge seam, swept titanium temples with the
 * battery + touch pod near the ear, waveguide patches in the lenses. Studio-lit with area lights,
 * a faint floor reflection and a HUD-only glow (a blurred copy of the capture). Post effects from
 * @react-three/postprocessing render black under Remotion's on-demand ThreeCanvas, so the vignette is
 * done in CSS by the scene and anti-aliasing is MSAA.
 * The display in the right lens is the REAL simulator capture, used as an emissive texture.
 */

RectAreaLightUniformsLib.init()

/** Display centre (inside the right lens, upper middle, where G2 projects). */
const DISPLAY: [number, number, number] = [LX, 0.25, 0.08]
const DISPLAY_W = 3.3
const FLOOR_Y = -2.6

function useStudio() {
  const { gl, scene } = useThree()
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.55
    scene.background = new THREE.Color('#07090A')
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = 1.15
    return () => {
      scene.environment = null
      scene.background = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
}

/** A blurred copy of the capture (canvas blur), so only the HUD glows: a selective bloom. */
function glowTexture(src: THREE.Texture): THREE.CanvasTexture {
  const img = src.image as HTMLImageElement
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.filter = 'blur(5px)'
    ctx.drawImage(img, 0, 0)
    ctx.filter = 'blur(14px)'
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(img, 0, 0)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
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
  useLayoutEffect(() => {
    if (tex) continueRender(handle)
  }, [tex, handle])
  return tex
}

const radialTexture = (stops: [number, string][]): THREE.CanvasTexture => {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    for (const [o, col] of stops) g.addColorStop(o, col)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  }
  return new THREE.CanvasTexture(c)
}

function Floor() {
  const reflector = useMemo(() => {
    const r = new Reflector(new THREE.PlaneGeometry(60, 60), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x1a1d20 })
    r.rotation.x = -Math.PI / 2
    r.position.y = FLOOR_Y
    return r
  }, [])
  // Fade the mirror to a faint, soft reflection: dark everywhere except under the glasses.
  const fade = useMemo(() => radialTexture([[0, 'rgba(7,9,10,0.7)'], [0.3, 'rgba(7,9,10,0.88)'], [0.6, 'rgba(7,9,10,1)'], [1, 'rgba(7,9,10,1)']]), [])
  const shadow = useMemo(() => radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]), [])
  return (
    <>
      <primitive object={reflector} />
      <mesh position={[0, FLOOR_Y + 0.01, -5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial map={fade} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.02, -5.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18, 12]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  )
}

interface GlassesProps {
  tex: THREE.Texture
  lit: number
}

function Glasses({ tex, lit }: GlassesProps) {
  const glow = useMemo(() => glowTexture(tex), [tex])
  const geo = useMemo(
    () => ({
      rim: rimGeometry(),
      lens: lensGeometry(),
      wave: waveguideGeometry(),
      temple: sweep(templeCurve(), templeSection, 320, 40),
      end: sweep(endPieceCurve(), endPieceSection, 60, 40),
      seam: sweep(
        new THREE.LineCurve3(new THREE.Vector3(HINGE_X, 1.18, -0.73), new THREE.Vector3(HINGE_X, 1.18, -0.83)),
        () => ({ w: 0.17, h: 0.38 }),
        4,
        40,
      ),
      bridge: sweep(bridgeCurve(), t => ({ w: 0.15 - Math.sin(t * Math.PI) * 0.03, h: 0.2 - Math.sin(t * Math.PI) * 0.04 }), 80, 32),
      padArm: [sweep(padArmCurve(1), () => ({ w: 0.035, h: 0.035 }), 30, 12), sweep(padArmCurve(-1), () => ({ w: 0.035, h: 0.035 }), 30, 12)],
    }),
    [],
  )
  const mats = useMemo(() => {
    const noise = roughnessNoise()
    return {
      front: new THREE.MeshPhysicalMaterial({ color: '#2c2f33', metalness: 0.45, roughness: 0.42, roughnessMap: noise, clearcoat: 0.3, clearcoatRoughness: 0.22 }),
      titanium: new THREE.MeshPhysicalMaterial({ color: '#34383c', metalness: 0.85, roughness: 0.34, roughnessMap: noise, clearcoat: 0.15, clearcoatRoughness: 0.3 }),
      seam: new THREE.MeshStandardMaterial({ color: '#0a0b0c', roughness: 0.8, metalness: 0.2 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 1, ior: 1.5, thickness: 0.2, specularIntensity: 1, envMapIntensity: 1.2 }),
      wave: new THREE.MeshPhysicalMaterial({ color: '#9fb8c4', roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.07, iridescence: 1, iridescenceIOR: 1.6, depthWrite: false }),
      pad: new THREE.MeshPhysicalMaterial({ color: '#4a4f52', roughness: 0.4, transmission: 0.2, thickness: 0.15, ior: 1.45 }),
    }
  }, [])
  return (
    <group>
      {[-1, 1].map(side => (
        <group key={side} scale={[side, 1, 1]}>
          <group position={[LX, 0, 0]}>
            <mesh geometry={geo.rim} material={mats.front} />
            <mesh geometry={geo.lens} material={mats.glass} />
            <mesh geometry={geo.wave} material={mats.wave} position={[0, 0, 0.065]} />
          </group>
          <mesh geometry={geo.end} material={mats.front} />
          <mesh geometry={geo.seam} material={mats.seam} />
          <mesh geometry={geo.temple} material={mats.titanium} />
          <mesh geometry={geo.padArm[0]} material={mats.titanium} />
          <mesh position={[BRIDGE - 0.14, -0.2, -0.5]} rotation={[0.2, 0.5, 0]} scale={[0.12, 0.24, 0.06]} material={mats.pad}>
            <sphereGeometry args={[1, 32, 24]} />
          </mesh>
        </group>
      ))}
      <mesh geometry={geo.bridge} material={mats.front} />
      <mesh position={[DISPLAY[0], DISPLAY[1], DISPLAY[2] - 0.004]}>
        <planeGeometry args={[DISPLAY_W, DISPLAY_W / 2]} />
        <meshBasicMaterial map={glow} transparent opacity={lit * 0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} color="#3DFF7A" />
      </mesh>
      <mesh position={DISPLAY}>
        <planeGeometry args={[DISPLAY_W, DISPLAY_W / 2]} />
        <meshBasicMaterial map={tex} transparent opacity={lit} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} color={new THREE.Color(1.6, 1.6, 1.6)} />
      </mesh>
    </group>
  )
}

interface SceneProps {
  f: number
  tex: THREE.Texture
  litAt: number
  dollyFrom: number
  dollyTo: number
}

function Scene({ f, tex, litAt, dollyFrom, dollyTo }: SceneProps) {
  useStudio()
  const { camera } = useThree()
  // Hero: a low 3/4 orbit from the left-front that settles towards the front before the push.
  const o = EASE.inOut(lin(f, [0, dollyFrom], [0, 1]))
  const ang = 0.95 - o * 0.85
  const radius = 46 - o * 8
  const orbit = new THREE.Vector3(Math.sin(ang) * radius - 1.5, -0.6 + o * 1.6, Math.cos(ang) * radius - 5)
  // Push into the right lens: 1152 px wide display, 70 px above centre, as the 2D lens shot after it.
  const d = EASE.inOut(lin(f, [dollyFrom, dollyTo], [0, 1]))
  const end = new THREE.Vector3(DISPLAY[0], DISPLAY[1] - 0.095, DISPLAY[2] + 8.77)
  camera.position.lerpVectors(orbit, end, d)
  const look = new THREE.Vector3(0, -0.1, -5).lerp(new THREE.Vector3(DISPLAY[0], DISPLAY[1] - 0.095, DISPLAY[2]), d)
  camera.lookAt(look)
  camera.updateProjectionMatrix()

  const lit = lin(f, [litAt, litAt + 10], [0, 1])
  // A glint: a narrow strip light that sweeps across the frame on the bar line at 0:26.
  const glint = lin(f, [60, 78], [-16, 16])
  const glintOn = f >= 58 && f <= 80 ? 1 : 0
  return (
    <>
      <rectAreaLight position={[-9, 9, 10]} width={14} height={10} intensity={2.6} color="#fff4e6" onUpdate={l => l.lookAt(0, 0, -4)} />
      <rectAreaLight position={[2, 7, 2]} width={22} height={0.8} intensity={2.6} color="#ffffff" onUpdate={l => l.lookAt(2, 0, -6)} />
      <rectAreaLight position={[6, 3, -6]} width={0.8} height={20} rotation={[0, 0, Math.PI / 2]} intensity={2.2} color="#e8f0ff" onUpdate={l => l.lookAt(3, 1, -6)} />
      <rectAreaLight position={[glint, 4, 6]} width={1.2} height={14} intensity={9 * glintOn} color="#ffffff" onUpdate={l => l.lookAt(glint, 0, -2)} />
      <directionalLight position={[4, 6, -16]} intensity={3.2} color="#cfe0ff" />
      <pointLight position={[DISPLAY[0], DISPLAY[1] - 2.6, -0.6]} intensity={lit * 1.4} distance={5} color="#3DFF7A" />
      <Floor />
      <Glasses tex={tex} lit={lit} />
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
    <ThreeCanvas width={width} height={height} gl={{ antialias: true, alpha: false }} dpr={1.5} camera={{ fov: 20, near: 0.1, far: 200, position: [0, 1.6, 40] }}>
      <Scene f={f} tex={tex} litAt={litAt} dollyFrom={dollyFrom} dollyTo={dollyTo} />
    </ThreeCanvas>
  )
}
