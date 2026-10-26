import * as THREE from 'three'
import { radialTexture } from './textures'

/**
 * The classic football: a truncated icosahedron (12 black pentagons, 20 white hexagons) shaded
 * procedurally on a sphere. Each fragment finds the polyhedron face its direction passes through
 * (largest dot(n, c) / d over the 32 face planes), so pentagons and hexagons get their true sizes;
 * the margin to the runner-up face draws the thin dark seams.
 */

const PHI = (1 + Math.sqrt(5)) / 2

function evenPermutations([a, b, c]: [number, number, number]): Array<[number, number, number]> {
  return [
    [a, b, c],
    [b, c, a],
    [c, a, b],
  ]
}

function signs([a, b, c]: [number, number, number]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (const sa of a === 0 ? [1] : [1, -1])
    for (const sb of b === 0 ? [1] : [1, -1]) for (const sc of c === 0 ? [1] : [1, -1]) out.push([a * sa, b * sb, c * sc])
  return out
}

/** Vertices of a truncated icosahedron with edge length 2. */
function truncatedIcosahedron(): THREE.Vector3[] {
  const seeds: Array<[number, number, number]> = [
    [0, 1, 3 * PHI],
    [1, 2 + PHI, 2 * PHI],
    [PHI, 2, PHI ** 3],
  ]
  const out: THREE.Vector3[] = []
  for (const s of seeds) for (const p of evenPermutations(s)) for (const v of signs(p)) out.push(new THREE.Vector3(...v))
  return out
}

function faceCentres(): { dirs: THREE.Vector3[]; inv: number[] } {
  // pentagons sit over the icosahedron's vertices, hexagons over its faces (the dodecahedron's vertices)
  const pent: THREE.Vector3[] = []
  for (const p of evenPermutations([0, 1, PHI])) for (const v of signs(p)) pent.push(new THREE.Vector3(...v).normalize())
  const hex: THREE.Vector3[] = []
  for (const v of signs([1, 1, 1])) hex.push(new THREE.Vector3(...v).normalize())
  for (const p of evenPermutations([0, 1 / PHI, PHI])) for (const v of signs(p)) hex.push(new THREE.Vector3(...v).normalize())
  const verts = truncatedIcosahedron()
  const dirs = [...pent, ...hex]
  // each face plane is the supporting plane of the solid in its centre direction
  const inv = dirs.map((c) => 1 / Math.max(...verts.map((v) => v.dot(c))))
  return { dirs, inv }
}

const FACES = faceCentres()

const VERT = /* glsl */ `
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vObjN = normalize(position);
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
uniform vec3 uCentres[32];
uniform float uInv[32];
uniform vec3 uTint;
uniform float uOpacity;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vec3 n = normalize(vObjN);
  float best = -1.0;
  float second = -1.0;
  int bi = 0;
  for (int i = 0; i < 32; i++) {
    float s = dot(n, uCentres[i]) * uInv[i];
    if (s > best) { second = best; best = s; bi = i; }
    else if (s > second) { second = s; }
  }
  bool pent = bi < 12;
  vec3 base = pent ? vec3(0.05, 0.055, 0.06) : vec3(0.95, 0.95, 0.92);
  float edge = (best - second) / best;
  float aa = fwidth(edge) * 1.5;
  float seam = 1.0 - smoothstep(0.012, 0.012 + aa + 0.004, edge);
  vec3 col = mix(base, vec3(0.16, 0.17, 0.18), seam * (pent ? 0.5 : 0.9));
  vec3 N = normalize(vViewN);
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(vec3(-0.35, 0.85, 0.45));
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 28.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  vec3 lit = col * (0.42 + 0.7 * diff) + spec * 0.28 + rim * vec3(0.96, 0.72, 0.25) * 0.1;
  gl_FragColor = vec4(lit * uTint, uOpacity);
  #include <colorspace_fragment>
}
`

export function ballMaterial(tint = new THREE.Color(1, 1, 1), opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCentres: { value: FACES.dirs },
      uInv: { value: FACES.inv },
      uTint: { value: tint },
      uOpacity: { value: opacity },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
  })
}

export const BALL_R = 0.5

export interface BallRig {
  group: THREE.Group
  sphere: THREE.Mesh
  material: THREE.ShaderMaterial
  halo: THREE.Sprite
  shadow: THREE.Mesh
  setOpacity: (v: number) => void
}

/** Ball + dark outline shell + contact shadow + flood halo, so it reads at any zoom. */
export function makeBall(opts: { tint?: THREE.Color; halo: string; opacity?: number }): BallRig {
  const group = new THREE.Group()
  const material = ballMaterial(opts.tint, opts.opacity ?? 1)
  // the ball is drawn over everything (never hidden under a disc), outline first, then the ball
  material.depthTest = false
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32), material)
  sphere.position.y = BALL_R
  sphere.renderOrder = 21
  const shellMat = new THREE.MeshBasicMaterial({ color: 0x0b1214, side: THREE.BackSide, transparent: true, opacity: 0.9, depthTest: false })
  const shell = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.13, 32, 20), shellMat)
  shell.renderOrder = 20
  sphere.add(shell)
  const haloTex = radialTexture(opts.halo, 'rgba(0,0,0,0)', 128, [[0.25, opts.halo.replace(/[\d.]+\)$/, '0.32)')]])
  // depth-tested so the ball itself is never tinted by its own glow
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending })
  const halo = new THREE.Sprite(haloMat)
  halo.scale.set(4.6, 4.6, 1)
  halo.position.y = BALL_R
  halo.renderOrder = 5
  const shadowTex = radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 64)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  )
  shadow.position.y = 0.03
  shadow.renderOrder = 2
  group.add(shadow, halo, sphere)
  const base = opts.opacity ?? 1
  const setOpacity = (v: number) => {
    material.uniforms.uOpacity!.value = base * v
    material.transparent = true
    shellMat.opacity = 0.9 * v
    haloMat.opacity = v
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = v
    group.visible = v > 0.01
  }
  return { group, sphere, material, halo, shadow, setOpacity }
}
