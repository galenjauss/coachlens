import * as THREE from 'three'

/**
 * Geometry for the Even G2 model. Units: 1 = 10 mm. Proportions follow the published G2 A fit
 * (lens 47.7 × 41.3 mm, bridge ~18 mm, temple 138.9 mm) and the reviewed silhouette: a thin
 * magnesium front with rounded lenses and a flat top, slim titanium temples that hold the optics at
 * the hinge and a battery + touch pod near the ear, and a screwless hinge.
 */

export const A = 2.385 // lens half-width
export const B = 2.065 // lens half-height
export const BRIDGE = 0.9 // half bridge
export const LX = A + BRIDGE // lens centre x
export const RIM = 0.19 // front rim width
export const TEMPLE_LEN = 13.89

/** G2 A lens outline: flat-ish top, rounded bottom, slightly wider at the top. */
export const lensOutline = (a: number, b: number, n = 128): THREE.Vector2[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const y = s > 0 ? b * Math.abs(s) ** 0.32 * 0.96 : -b * Math.abs(s) ** 0.85
    const taper = 1 + 0.07 * (y / b)
    return new THREE.Vector2(Math.sign(c) * Math.abs(c) ** 0.62 * a * taper, y)
  })

export function rimGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(lensOutline(A + RIM, B + RIM))
  shape.holes.push(new THREE.Path(lensOutline(A, B).reverse()))
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 6, curveSegments: 128 })
  g.translate(0, 0, -0.1)
  g.computeVertexNormals()
  return g
}

export function lensGeometry(): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(lensOutline(A + 0.03, B + 0.03)), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 128 })
  g.translate(0, 0, -0.05)
  return g
}

/** The waveguide patch: G2's light-catching area over the top ~40% of each lens. */
export function waveguideGeometry(): THREE.ShapeGeometry {
  const pts = lensOutline(A - 0.25, B - 0.25).filter(p => p.y > 0.05)
  const shape = new THREE.Shape([new THREE.Vector2(pts[pts.length - 1]?.x ?? -A, 0.05), ...pts, new THREE.Vector2(pts[0]?.x ?? A, 0.05)])
  return new THREE.ShapeGeometry(shape, 48)
}

export type Section = { w: number; h: number }

/**
 * A swept solid: a squircle cross-section (superellipse n=4, so a soft rounded rectangle) carried
 * along a curve, with width and height varying along it, closed with rounded caps. Frames use a
 * fixed up-vector (no Frenet twist) so the long temple highlight stays straight.
 */
export function sweep(curve: THREE.Curve<THREE.Vector3>, section: (t: number) => Section, segments = 200, radial = 40, up = new THREE.Vector3(0, 1, 0)): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const ring = (t: number) => {
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t).normalize()
    let bin = new THREE.Vector3().crossVectors(tan, up)
    if (bin.lengthSq() < 1e-6) bin = new THREE.Vector3(1, 0, 0)
    bin.normalize()
    const nor = new THREE.Vector3().crossVectors(bin, tan).normalize()
    const { w, h } = section(t)
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      const x = Math.sign(c) * Math.abs(c) ** 0.5 * (w / 2)
      const y = Math.sign(s) * Math.abs(s) ** 0.5 * (h / 2)
      pos.push(p.x + bin.x * x + nor.x * y, p.y + bin.y * x + nor.y * y, p.z + bin.z * x + nor.z * y)
    }
  }
  for (let i = 0; i <= segments; i++) ring(i / segments)
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j
      const b = i * radial + ((j + 1) % radial)
      const c = (i + 1) * radial + j
      const d = (i + 1) * radial + ((j + 1) % radial)
      idx.push(a, c, b, b, c, d)
    }
  // Rounded caps: a short fan pushed out along the tangent.
  const cap = (t: number, dir: 1 | -1) => {
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t).normalize().multiplyScalar(dir)
    const { w, h } = section(t)
    const centre = pos.length / 3
    const bulge = Math.min(w, h) * 0.3
    pos.push(p.x + tan.x * bulge, p.y + tan.y * bulge, p.z + tan.z * bulge)
    const base = t === 0 ? 0 : segments * radial
    for (let j = 0; j < radial; j++) {
      const a = base + j
      const b = base + ((j + 1) % radial)
      if (dir === 1) idx.push(a, b, centre)
      else idx.push(b, a, centre)
    }
  }
  cap(0, -1)
  cap(1, 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}
const bump = (t: number, a: number, b: number, c: number, d: number) => smooth(a, b, t) * (1 - smooth(c, d, t))

/** X of the hinge, just outside the lens rim. */
export const HINGE_X = LX + A + RIM + 0.34
export const HINGE_Y = 1.18
export const HINGE_Z = -0.78

/** Right-side temple (mirror x for the left): straight, gently in, then down behind the ear. */
export function templeCurve(): THREE.CatmullRomCurve3 {
  const x = HINGE_X
  return new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(x, HINGE_Y, HINGE_Z - 0.04),
      new THREE.Vector3(x + 0.22, HINGE_Y + 0.02, -3.2),
      new THREE.Vector3(x + 0.48, HINGE_Y + 0.02, -6.4),
      new THREE.Vector3(x + 0.62, HINGE_Y - 0.03, -9.3),
      new THREE.Vector3(x + 0.58, HINGE_Y - 0.2, -11.4),
      new THREE.Vector3(x + 0.42, HINGE_Y - 0.75, -12.75),
      new THREE.Vector3(x + 0.3, HINGE_Y - 1.55, -13.45),
    ],
    false,
    'centripetal',
  )
}

/** Temple section: slim titanium (2.9 × 1.2 mm), the battery + touch pod near the ear, a rounded tip. */
export const templeSection = (t: number): Section => {
  const pod = bump(t, 0.6, 0.68, 0.84, 0.92)
  const tip = smooth(0.9, 1, t)
  return {
    w: 0.125 + pod * 0.15 - tip * 0.02 + (1 - smooth(0, 0.08, t)) * 0.05,
    h: 0.3 + pod * 0.22 - tip * 0.07 + (1 - smooth(0, 0.08, t)) * 0.08,
  }
}

/** End piece: lofts from the front's outer edge back into the temple (it houses the optics). */
export function endPieceCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(LX + A + RIM - 0.06, HINGE_Y + 0.02, -0.04),
      new THREE.Vector3(LX + A + RIM + 0.12, HINGE_Y + 0.02, -0.1),
      new THREE.Vector3(HINGE_X - 0.02, HINGE_Y, -0.42),
      new THREE.Vector3(HINGE_X, HINGE_Y, HINGE_Z + 0.04),
    ],
    false,
    'centripetal',
  )
}
export const endPieceSection = (t: number): Section => ({ w: 0.42 - t * 0.22, h: 0.7 - t * 0.28 })

/** The keyhole bridge: an arch from rim to rim, slightly proud of the front. */
export function bridgeCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-BRIDGE + 0.1, 1.2, 0.0),
    new THREE.Vector3(-0.45, 1.48, 0.04),
    new THREE.Vector3(0, 1.6, 0.05),
    new THREE.Vector3(0.45, 1.48, 0.04),
    new THREE.Vector3(BRIDGE - 0.1, 1.2, 0.0),
  ])
}

/** Pad arm: from the inner rim back and down to the nose pad. */
export function padArmCurve(side: 1 | -1): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * (BRIDGE - 0.1), 0.35, -0.1),
    new THREE.Vector3(side * (BRIDGE - 0.16), 0.15, -0.3),
    new THREE.Vector3(side * (BRIDGE - 0.16), -0.05, -0.45),
  ])
}

/** Procedural roughness noise (subtle satin variation), deterministic. */
export function roughnessNoise(): THREE.DataTexture {
  const n = 256
  const data = new Uint8Array(n * n * 4)
  let seed = 7
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < n * n; i++) {
    const v = 214 + Math.floor(rnd() * 41)
    data.set([v, v, v, 255], i * 4)
  }
  const tex = new THREE.DataTexture(data, n, n)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 6)
  tex.needsUpdate = true
  return tex
}
