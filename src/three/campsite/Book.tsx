import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { sfxBookClose, sfxBookOpen, sfxPageTurn } from '../../lib/audio'
import { damp } from '../../lib/scroll'
import { BOOK_COVER_SUBTITLE, BOOK_TITLE, bookSpreads } from './bookContent'
import {
  PAGE_H,
  PAGE_W,
  imagesIn,
  loadBookFonts,
  paintCover,
  paintPage,
  paintPaper,
  preloadBookImages,
  type Hit,
  type ImageHit,
  type Rect,
} from './bookPaint'
import {
  BOW,
  GUTTER,
  PAGE_GUTTER,
  GUTTER_DIP,
  HINGE_Y,
  PAGE_DEPTH,
  PAGE_MAX_LIFT,
  FOLD_LIFT,
  SQUARE,
  buildCover,
  buildGutter,
  buildPageBlock,
  buildSpine,
  makeEdgeTexture,
  makeLeatherMaps,
  BINDINGS,
  BOARD_GROUND,
  pageTopY,
} from './bookGeometry'

/* -------------------------------------------------------------------------- */
/*  The journal in each tent.                                                   */
/*                                                                              */
/*  Built in code — boards, spine, text block and printed pages — rather than    */
/*  loaded from a model. The downloaded book was frozen open, so its closed      */
/*  state had to be faked by splitting every mesh down the spine and hanging     */
/*  one half on a hinge; and because its own page surfaces were part of that     */
/*  model, the writing had to be floated on separate quads above them. That is   */
/*  what made it read as two lit cards hovering over a book. Here the printed    */
/*  surface *is* the top face of the text block, so there is nothing to float,   */
/*  and the closed state is what the geometry does when the hinge rotates.       */
/*                                                                              */
/*  Text is still painted into the page textures rather than floated in front    */
/*  of the model, so it bows with the paper, dims with the candles, and is gone  */
/*  when the book shuts.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Dev-only: pins the ink reveal, so a screenshot of a finished page does not
 * have to wait out an animation the headless renderer runs at a frame a second.
 */
function devParam(name: string) {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(name)
  return v === null || Number.isNaN(Number(v)) ? null : Number(v)
}

const FROZEN_REVEAL = devParam('reveal')

/**
 * Dev-only: `?turn=0.5` starts a forward page turn and pins it mid-swing.
 *
 * The turn is the one animation in here that cannot be judged from either end
 * — the whole question is what the sheet looks like while it is in the air —
 * and the headless capture runs at about a frame a second.
 */
const FROZEN_TURN = devParam('turn')

/**
 * Dev-only: `?spread=7` opens the journal on that leaf.
 *
 * The projects journal is twenty spreads deep now. Turning to the tool pages a
 * corner at a time to look at one of them costs nineteen page-turn animations,
 * and the headless capture runs at about a frame a second.
 */
const FROZEN_SPREAD = devParam('spread')

/**
 * How far the hinged half sinks as the journal shuts.
 *
 * Twice the crest height: that is exactly the gap a half-turn about the crest
 * opens up at the fore edge. See the hinge in the frame loop.
 */
const CLOSE_NEST = 2 * PAGE_MAX_LIFT

/** A page's footprint on screen, in CSS pixels relative to the canvas. */
export interface PageScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/* --------------------------------------------------------------- page ink */

/**
 * A lit sheet of paper with writing on it.
 *
 * The paper is the material's own colour map and the ink is a second, mostly
 * transparent map composited over it inside `<map_fragment>` — so both are lit
 * by the candles, both take the page's curvature, and the writing can arrive
 * line by line without the paper arriving with it. The previous journal drew
 * the ink through an unlit `ShaderMaterial`, which is why the writing kept its
 * brightness no matter what the room was doing.
 */
function makePaperMaterial(paper: THREE.Texture, ink: THREE.Texture) {
  const uReveal = { value: 0 }
  const uInk = { value: ink }

  const material = new THREE.MeshStandardMaterial({
    map: paper,
    roughness: 0.95,
    metalness: 0,
    // A trace of self-illumination, keyed to the paper itself. A page in a tent
    // at night lit only by two wicks falls off a cliff at the outer corners;
    // this keeps it legible without lighting the room.
    emissive: new THREE.Color('#332c21'),
    emissiveMap: paper,
    emissiveIntensity: 0.16,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = uInk
    shader.uniforms.uReveal = uReveal
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uInk;
         uniform float uReveal;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           // Ink arrives down the page, with a warm wet line at the writing
           // edge. v is 1 at the head of the page, so depth counts downward.
           //
           // The reveal is overrun past the foot of the sheet. The wet band is
           // a tenth of the page deep, so a reveal that stops at exactly 1.0
           // leaves the bottom tenth permanently half-written — which is the
           // whole reason the folio was the one thing on the page nobody could
           // read.
           vec4 inkTex = texture2D( uInk, vMapUv );
           float depth = 1.0 - vMapUv.y;
           float r = uReveal * 1.14;
           float written = smoothstep( r, r - 0.10, depth );
           float wet = smoothstep( r - 0.10, r, depth ) * written;
           diffuseColor.rgb = mix( diffuseColor.rgb, inkTex.rgb, inkTex.a * written );
           diffuseColor.rgb += vec3( 1.0, 0.60, 0.24 ) * wet * inkTex.a * 0.5;
         }`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
           /*
             Roll the paper's highlights off before the frame does.

             Firelight in a tent is not even, and it should not be: the candles
             are centimetres from the outer edge of each page and the inverse
             square across a half-metre sheet is brutal. But a page is something
             the reader has to *read*, and where the falloff put the paper above
             white the type went with it — the ink is composited into the same
             diffuse term, so a blown page is a page with no writing on it.

             A Reinhard shoulder on the outgoing light keeps the gradient (the
             hot side still reads as the hot side) while pulling the top of it
             back under the ceiling, so the contrast between ink and paper
             survives everywhere on the sheet. It is applied here rather than
             by fixing the lights because the lights are also what makes the
             room look like a room.
           */
           outgoingLight = outgoingLight / ( 1.0 + outgoingLight * 0.62 );
         }
         #include <opaque_fragment>`
      )
  }

  return { material, setReveal: (v: number) => (uReveal.value = v) }
}

/**
 * The turning sheet. One double-sided plane carrying the outgoing page on its
 * front and the incoming one on its back.
 *
 * Which face is showing comes from `gl_FrontFacing` rather than from a uniform
 * the animation has to remember to flip: past ninety degrees the back of the
 * sheet is genuinely what faces the camera, and asking the rasteriser is both
 * simpler and impossible to get out of step with the rotation.
 */
function makeLeafMaterial(front: THREE.Texture, back: THREE.Texture) {
  const uBack = { value: back }
  /** Peak lag angle at the fore edge, radians. */
  const uLag = { value: 0 }
  /** Extra bulge through the middle of the sheet. */
  const uBow = { value: 0 }
  /** 1 while the sheet is lying on a block, 0 at the top of the swing. */
  const uRest = { value: 1 }
  /** 0 on either block, 1 while the sheet is upright. Holds paper exposure. */
  const uTurnLift = { value: 0 }
  /**
   * cos of the group's own rotation: +1 at the start of a turn, -1 at the end.
   *
   * The rest profile is a height, and it is computed in the sheet's own frame —
   * but by the end of the swing that frame is upside down, so a displacement of
   * *up* is applied as *down*. Since the profile is negative (it hangs the sheet
   * below the hinge, which sits at the crest), inverting it hung the sheet the
   * same distance above instead: at the fore edge, twice the crest height, which
   * on this book is a centimetre and a half of clear air under a page that is
   * supposed to be lying on the paper. That is the sheet that looks like a
   * separate object floating over the book just before it lands.
   */
  const uFlip = { value: 1 }
  const uDir = { value: 1 }
  const uSpineOff = { value: 0 }
  const uHalfW = { value: 1 }

  const material = new THREE.MeshStandardMaterial({
    map: front,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    // Same trace of self-illumination the blocks carry — see makePaperMaterial.
    // Without it the sheet was lit by the candles alone while the pages under it
    // were lit by the candles *plus* that lift, so the leaf came off the block a
    // different colour from the page it had just been, which is most of what
    // made it read as a second object rather than as the page moving.
    emissive: new THREE.Color('#332c21'),
    emissiveIntensity: 0.16,
    // The sheet lies flush on the block at both ends of the swing — it is the
    // top leaf of that block — so at rest it is coplanar with the printed face
    // and would z-fight it. Biasing the leaf toward the camera settles that
    // without lifting it into the air, which is what the old clearance did.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBack = uBack
    shader.uniforms.uLag = uLag
    shader.uniforms.uBow = uBow
    shader.uniforms.uRest = uRest
    shader.uniforms.uTurnLift = uTurnLift
    shader.uniforms.uFlip = uFlip
    shader.uniforms.uDir = uDir
    shader.uniforms.uSpineOff = uSpineOff
    shader.uniforms.uHalfW = uHalfW
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uLag;
         uniform float uBow;
         uniform float uRest;
         uniform float uFlip;
         uniform float uDir;
         uniform float uSpineOff;
         uniform float uHalfW;

         // Same profile the page blocks are built to — see pageLift in
         // bookGeometry.ts. u is 0 at the fore edge, 1 at the spine.
         float leafLift( float u ) {
           float t = clamp( ( u - 0.86 ) / 0.14, 0.0, 1.0 );
           return ${BOW.toFixed(4)} * pow( max( u, 0.0 ), 1.6 )
                - ${GUTTER_DIP.toFixed(4)} * ( t * t * ( 3.0 - 2.0 * t ) );
         }

         // d leafLift / d u. The turning sheet uses the same height profile as
         // the stationary blocks, so its normal must use the same slope too.
         // Rotating only the original flat normal made the leaf change shade
         // the instant it lifted, even while its silhouette was still flush.
         float leafLiftSlope( float u ) {
           float safeU = max( u, 0.00001 );
           float bowSlope = ${BOW.toFixed(4)} * 1.6 * pow( safeU, 0.6 );
           float t = clamp( ( u - 0.86 ) / 0.14, 0.0, 1.0 );
           float insideDip = step( 0.86, u ) * ( 1.0 - step( 1.0, u ) );
           float dipSlope = -${GUTTER_DIP.toFixed(4)}
             * ( 6.0 * t * ( 1.0 - t ) / 0.14 ) * insideDip;
           return bowSlope + dipSlope;
         }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           /*
             A sheet of paper, not a rigid plate.

             The whole turn used to be the group's rotation and nothing else: a
             flat rectangle swept through 180 degrees, which is why it read as a
             card being spawned and despawned rather than as a page. Two things
             fix that, and both happen here.

             The lag. Every point on the sheet is rotated *back* about the spine
             by an angle that grows toward the fore edge, so the outer edge
             trails the binding through the swing and the sheet curls the way
             held paper does. The group carries the gross rotation; this carries
             the flex.

             The rest profile. At either end of the turn the sheet has to lie on
             the block it is landing on, and a block is not flat — it climbs
             from the fore edge and dips into the gutter. Sampling the same
             curve the blocks are built to, faded out through the middle of the
             swing, is what stops the sheet popping off the paper at the start
             and clipping into it at the finish.
           */
           // Signed x in the hinge group's frame, and the distance from the
           // spine as a 0..1 parameter across the half-spread.
           float gx = transformed.x + uDir * uSpineOff;
           float s = clamp( ( abs( gx ) - ( uSpineOff - uHalfW * 0.5 ) ) / uHalfW, 0.0, 1.0 );

           // Height at rest: the block's own profile, relative to the hinge —
           // and in world terms, which past the top of the swing means undoing
           // the group's own flip. See uFlip.
           float rest = ( leafLift( 1.0 - s ) - ${FOLD_LIFT.toFixed(4)} ) * uRest * uFlip;
           float gy = rest + uBow * sin( 3.14159265 * s ) * ( 1.0 - uRest );

           // Trail the binding. Negative for a forward turn, positive for a
           // backward one, so the fore edge always hangs behind the swing.
           float phi = -uDir * uLag * pow( s, 1.3 );
           float c = cos( phi );
           float sn = sin( phi );
           transformed.x = gx * c - gy * sn - uDir * uSpineOff;
           transformed.z = gx * sn + gy * c;
         }`
      )
      // The normals have to follow, or a curled sheet is lit as if it were
      // still flat and the curl is invisible in everything but the silhouette.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         {
           float gx0 = position.x + uDir * uSpineOff;
           float s0 = clamp( ( abs( gx0 ) - ( uSpineOff - uHalfW * 0.5 ) ) / uHalfW, 0.0, 1.0 );
           float dRestDs = -leafLiftSlope( 1.0 - s0 ) * uRest * uFlip;
           float dBowDs = uBow * 3.14159265 * cos( 3.14159265 * s0 ) * ( 1.0 - uRest );
           float dGyDx = ( dRestDs + dBowDs ) * uDir / uHalfW;
           objectNormal = normalize( vec3( -dGyDx, 0.0, 1.0 ) );
           float phi0 = -uDir * uLag * pow( s0, 1.3 );
           float c0 = cos( phi0 );
           float sn0 = sin( phi0 );
           objectNormal = vec3(
             objectNormal.x * c0 - objectNormal.z * sn0,
             objectNormal.y,
             objectNormal.x * sn0 + objectNormal.z * c0
           );
         }`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uBack;
         uniform float uTurnLift;`
      )
      .replace(
        '#include <map_fragment>',
        // Both canvases are declared sRGB, so the sampler decodes them on the
        // way in — no manual conversion, which would double-apply it.
        `vec2 leafUv = gl_FrontFacing ? vMapUv : vec2( 1.0 - vMapUv.x, vMapUv.y );
         diffuseColor *= gl_FrontFacing
           ? texture2D( map, leafUv )
           : texture2D( uBack, leafUv );`
      )
      // The blocks key their emissive to the paper through an emissiveMap. The
      // leaf cannot use one — which face is showing is only known in the
      // fragment — so it keys to the sheet it just sampled instead, which comes
      // to the same thing and additionally lets the ink stay ink.
      .replace('#include <emissivemap_fragment>', `totalEmissiveRadiance *= diffuseColor.rgb;`)
      // And the same Reinhard shoulder the pages get. Applying it to one and not
      // the other is a visible seam at both ends of the turn: the sheet blows out
      // on the candle side exactly where the page beneath it does not.
      .replace(
        '#include <opaque_fragment>',
        `/*
           A vertical sheet faces away from both lanterns, so physically lit
           StandardMaterial falls several stops below the flat page and then
           snaps back on landing. Preserve the paper/ink ratio by blending
           toward a neutral exposure of the exact sampled page only while it
           is lifted. At both endpoints uTurnLift is zero, making the leaf and
           stationary block use identical lighting again.
         */
         // Neutral paper exposure calibrated to the resting page. The former
         // 1.62 multiplier was visibly brighter than the page block, so the
         // first non-zero drag frame looked like a light had switched on.
         vec3 stableLeaf = diffuseColor.rgb * 1.12;
         // Keep the real lighting through the first part of the lift, then
         // progressively stabilize it as the sheet turns away from the lamps.
         // This preserves a continuous grab while still preventing the upright
         // page from falling several stops into brown.
         float exposureHold = smoothstep( 0.08, 0.72, uTurnLift );
         outgoingLight = mix( outgoingLight, stableLeaf, exposureHold );
         outgoingLight = outgoingLight / ( 1.0 + outgoingLight * 0.62 );
         #include <opaque_fragment>`
      )
  }

  return {
    material,
    /** Static, set once the half-spread's dimensions are known. */
    setFrame: (dir: number, spineOff: number, halfW: number) => {
      uDir.value = dir
      uSpineOff.value = spineOff
      uHalfW.value = halfW
    },
    setFlex: (lag: number, bow: number, rest: number, flip: number) => {
      uLag.value = lag
      uBow.value = bow
      uRest.value = rest
      uTurnLift.value = 1 - rest
      uFlip.value = flip
    },
  }
}

/* ------------------------------------------------------- page-surface marks */

/**
 * A patch of the printed surface, as geometry.
 *
 * The page is not flat — it climbs from the fore edge, crests, and falls into
 * the gutter (see `pageLift`) — so a flat quad laid over it at one height cuts
 * through the paper: part of the mark sinks under the page and the rest floats,
 * and where the two meet the intersection draws a hard line straight across the
 * type. That line is the bug this replaces. Sampling `pageTopY` along the strip
 * makes the mark a copy of the surface it sits on, a few tenths of a millimetre
 * above it, so it stays whole however the paper bends.
 */
function buildPagePatch(
  side: 'left' | 'right',
  rect: Rect,
  segments = 12,
  surfaceLift = 0.0004
) {
  const half = 0.5 - PAGE_GUTTER
  const xa = (side === 'left' ? -0.5 : PAGE_GUTTER) + rect.x0 * half
  const xb = (side === 'left' ? -0.5 : PAGE_GUTTER) + rect.x1 * half
  const za = -PAGE_DEPTH / 2 + rect.y0 * PAGE_DEPTH
  const zb = -PAGE_DEPTH / 2 + rect.y1 * PAGE_DEPTH

  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const x = THREE.MathUtils.lerp(xa, xb, t)
    // A tenth of what it was, with the depth fight handed to a polygon offset
    // on the material instead (see `PageMark`). The old 3.5mm of float is not
    // visible head-on, but the book is read at a slant: at that angle a mark
    // hovering that far off the paper projects a few pixels away from the type
    // it is meant to be sitting on, which is why the page-turn highlight came
    // up offset from the words it was highlighting.
    const y = pageTopY(side, x) + surfaceLift
    pos.push(x, y, za, x, y, zb)
    uv.push(t, 1, t, 0)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

type TurnMode = 'idle' | 'drag' | 'commit' | 'cancel'
type TurnState = { t: number; dir: 1 | -1; to: number; mode: TurnMode }
type PageDragState = {
  pointerId: number
  startX: number
  dir: 1 | -1
  to: number
  started: boolean
  /** Pointer-requested turn amount. The rendered leaf approaches this at a capped rate. */
  target: number
}
type PageHoverTransition = {
  key: string
  side: 'left' | 'right'
  mix: number
  target: 0 | 1
  painted: number
}
type PaintedPage = ReturnType<typeof paintPage>
type PaintedSide = {
  spread: number
  identity: string
  page: PaintedPage
}

const FULL_PAGE_RECT: Rect = { x0: 0.012, y0: 0.012, x1: 0.988, y1: 0.988 }

/** Retain the first/last-page controls for later, but keep them out of the UI. */
const BOOK_SKIP_CONTROLS_ENABLED = false

/**
 * Fast mice can cross the whole spread between two pointer events. Keep the
 * physical leaf below this rate so high DPI changes distance, not animation
 * duration. At 2.4 a fully dragged page remains visible for at least 417 ms.
 */
const MAX_DRAG_PROGRESS_PER_SECOND = 2.4

/** Inverse of the quadratic turn ease, used to hand a dragged leaf to autoplay without a jump. */
function inverseTurnEase(value: number) {
  const y = THREE.MathUtils.clamp(value, 0, 1)
  return y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt((1 - y) / 2)
}

/** A canvas-backed texture that can be repainted in place. */
function makePageCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return { ctx, tex }
}

/* -------------------------------------------------------------------------- */

export interface BookProps {
  index: number
  /** Metres, measured across the open spread. */
  width?: number
  position: [number, number, number]
  rotationY?: number
  /**
   * 0 shut, 1 open, driven by the camera rig.
   *
   * A ref rather than a prop value: the cover moves every frame, and every one
   * of the three journals is mounted the whole time, so pushing this through
   * React state re-rendered three books a frame to move one hinge.
   */
  openRef: React.RefObject<number>
  /** False for the two journals the camera is not at — they stay shut. */
  enabled: boolean
  accent: string
  /** True once the camera has arrived: runs the reveal and arms the links. */
  live: boolean
  /**
   * A link on the page was pressed.
   *
   * `from` is the right-hand page's footprint on screen at the moment of the
   * click, in CSS pixels. The gameplay build grows out of that rectangle, so
   * the transition has to know where the page was — which only the renderer
   * does.
   */
  onNavigate: (to: string, from?: PageScreenRect) => void
  /**
   * A print on the page was pressed and wants a closer look.
   *
   * `from` is where that plate sits on screen, so the enlargement can grow out
   * of the page rather than appear over it.
   */
  onZoom?: (src: string, from: PageScreenRect) => void
  /** Fired when the closed cover is clicked — arms `openRef` upstream. */
  onOpenRequest: () => void
  /** The single upstream hover state shared by scale and outline selection. */
  closedHot: boolean
  onClosedHover: (index: number, hovered: boolean) => void
  /** Exposes the front board mesh to the shared outline pass. */
  registerOutlineTarget: (index: number, node: THREE.Object3D | null) => void
  /** Fired when "next" is clicked past the last spread, or "back" before the
      first — the edge pages double as the way to shut the journal. */
  onClose: () => void
}

export default function Book({
  index,
  width = 0.46,
  position,
  rotationY = 0,
  openRef,
  enabled,
  accent,
  live,
  onNavigate,
  onZoom,
  onOpenRequest,
  closedHot,
  onClosedHover,
  registerOutlineTarget,
  onClose,
}: BookProps) {
  /**
   * A getter for the renderer state, rather than the state itself.
   *
   * `useThree()` with no selector subscribes this component to every field in
   * the store, and all three journals are mounted the whole time — so a store
   * write during a frame re-rendered three books, and with the arming state
   * changing inside `useFrame` that was enough to trip React's update-depth
   * guard. Nothing here needs to re-render when the camera moves; it only needs
   * to read the camera on a click.
   */
  const getThree = useThree((s) => s.get)

  const spreads = useMemo(() => bookSpreads(index), [index])
  const imageSources = useMemo(
    () => [
      ...new Set(spreads.flatMap((sp) => [...imagesIn(sp.left), ...imagesIn(sp.right)])),
    ],
    [spreads]
  )

  // Clamped: the three journals are different lengths, and the parameter is
  // set once for all of them.
  const [spread, setSpread] = useState(
    FROZEN_SPREAD === null ? 0 : Math.max(0, Math.min(FROZEN_SPREAD, spreads.length - 1))
  )
  const hoveredLink = useRef<PageHoverTransition | null>(null)
  const hoveredImage = useRef<PageHoverTransition | null>(null)
  const [hits, setHits] = useState<{ hit: Hit; side: 'left' | 'right' }[]>([])
  const [plates, setPlates] = useState<{ hit: ImageHit; side: 'left' | 'right' }[]>([])
  /** Links and corner tabs only exist once the book is properly open. */
  const [armed, setArmed] = useState(false)

  const hinge = useRef<THREE.Group>(null)
  const shift = useRef<THREE.Group>(null)
  const hoverScale = useRef<THREE.Group>(null)
  const spine = useRef<THREE.Group>(null)
  const leaf = useRef<THREE.Group>(null)
  const leafMesh = useRef<THREE.Mesh>(null)
  /** The page blocks. Measured on screen when something opens out of a page. */
  const rightPage = useRef<THREE.Mesh>(null)
  const leftPage = useRef<THREE.Mesh>(null)
  const turn = useRef<TurnState>({ t: 1, dir: 1, to: 0, mode: 'idle' })
  const pageDrag = useRef<PageDragState | null>(null)
  /** While a held drag is exactly flat, draw the stationary page block instead
      of a visually similar second material laid over it. */
  const dragEndpoint = useRef<'start' | 'end' | null>(null)
  const reveal = useRef(0)
  /** True only after an inactive journal has had one full frame applied in its
      final closed pose. The next frames can leave those invariant transforms
      alone while retaining the candle-driven material response. */
  const inactiveSettled = useRef(false)
  /** This frame's `open`, mirrored for the cover's click handler — an event
      callback closes over stale state otherwise, and `open` itself only
      exists inside the animation frame below. */
  const openLevel = useRef(0)
  const closedHovered = useRef(false)
  const setFrontCover = useCallback(
    (node: THREE.Mesh | null) => registerOutlineTarget(index, node),
    [index, registerOutlineTarget]
  )

  /* ------------------------------------------------------------- geometry */

  const parts = useMemo(
    () => ({
      left: buildPageBlock('left'),
      right: buildPageBlock('right'),
      coverL: buildCover('left'),
      coverR: buildCover('right'),
      spine: buildSpine(),
      gutter: buildGutter(),
    }),
    []
  )
  useEffect(
    () => () => {
      parts.left.geometry.dispose()
      parts.right.geometry.dispose()
      parts.coverL.dispose()
      parts.coverR.dispose()
      parts.spine.dispose()
      parts.gutter.dispose()
    },
    [parts]
  )

  /* ------------------------------------------------------------ materials */

  const binding = BINDINGS[index] ?? 'leather'
  const leather = useMemo(
    () => makeLeatherMaps(accent, 17 + index * 41, binding, BOARD_GROUND[index]),
    [accent, index, binding]
  )
  const edgeTex = useMemo(() => makeEdgeTexture(51 + index * 13), [index])
  useEffect(
    () => () => {
      leather.dispose()
      edgeTex.dispose()
    },
    [leather, edgeTex]
  )

  const coverMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: leather.map,
        normalMap: leather.normalMap,
        // Fine grain, felt rather than seen: the relief carries the pit
        // pattern and nothing else, so the board takes a broad soft highlight
        // instead of a field of glints.
        normalScale: new THREE.Vector2(0.72, 0.72),
        // Leather, not book cloth and certainly not lacquer. High enough that
        // the candles spread across the board as one wide sheen rather than
        // striking a hot spot on it, and metalness stays at zero — a dyed hide
        // has no specular colour of its own.
        roughness: 0.82,
        metalness: 0,
      }),
    [leather]
  )
  const edgeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.96, metalness: 0 }),
    [edgeTex]
  )
  // The fold at the bottom of the valley. Was near-black (#2a1d16) back when it
  // spanned 28mm of open gutter and the job was to stop light coming through a
  // hole; at 4mm between two touching page blocks that value read as a hard
  // navy pinstripe ruled down the middle of the spread — dark enough that the
  // blue in the tent's own light was most of what came back off it. Paper in
  // shadow, not a slot: warm, and only a couple of stops under the printed
  // face beside it.
  const gutterMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a3a28', roughness: 1, metalness: 0 }),
    []
  )

  /**
   * The two sheets of paper, painted the moment their canvases exist.
   *
   * Not in an effect. A `CanvasTexture` is uploaded the first time the renderer
   * draws with it, and the renderer's loop is not the commit loop: paint the
   * canvas in `useLayoutEffect` and there is a window — small, machine
   * dependent, and wider the slower the machine — in which a frame can be drawn
   * from a canvas that is still blank. A blank canvas is transparent black, and
   * a colour map of transparent black is a *black page*: the journal opened onto
   * two slabs of nothing with its lit fore edge showing underneath, which is
   * exactly the fault this fixes. Painting inside the memo closes the window,
   * because the texture cannot be sampled before the object that owns it exists.
   */
  /** Seeds for the two sheets, shared with the turning leaf. See `paperSeed`. */
  const paperSeed = { left: 55 + index * 3, right: 91 + index * 5 }

  const leftPaper = useMemo(() => {
    const page = makePageCanvas()
    paintPaper(page.ctx, 'left', 55 + index * 3)
    page.tex.needsUpdate = true
    return page
  }, [index])
  const rightPaper = useMemo(() => {
    const page = makePageCanvas()
    paintPaper(page.ctx, 'right', 91 + index * 5)
    page.tex.needsUpdate = true
    return page
  }, [index])
  const leftInk = useMemo(makePageCanvas, [])
  const rightInk = useMemo(makePageCanvas, [])
  const leafFront = useMemo(makePageCanvas, [])
  const leafBack = useMemo(makePageCanvas, [])
  const coverPage = useMemo(makePageCanvas, [])

  const leftMat = useMemo(
    () => makePaperMaterial(leftPaper.tex, leftInk.tex),
    [leftPaper, leftInk]
  )
  const rightMat = useMemo(
    () => makePaperMaterial(rightPaper.tex, rightInk.tex),
    [rightPaper, rightInk]
  )
  const leafMat = useMemo(
    () => makeLeafMaterial(leafFront.tex, leafBack.tex),
    [leafFront, leafBack]
  )

  useEffect(
    () => () => {
      for (const page of [
        leftPaper,
        rightPaper,
        leftInk,
        rightInk,
        leafFront,
        leafBack,
        coverPage,
      ]) {
        page.tex.dispose()
      }
    },
    [leftPaper, rightPaper, leftInk, rightInk, leafFront, leafBack, coverPage]
  )

  useEffect(
    () => () => {
      for (const m of [
        coverMat,
        edgeMat,
        gutterMat,
        leftMat.material,
        rightMat.material,
        leafMat.material,
      ]) {
        m.dispose()
      }
    },
    [coverMat, edgeMat, gutterMat, leftMat, rightMat, leafMat]
  )

  /* -------------------------------------------------------------- content */

  const folio = (n: number) => `${n} / ${spreads.length * 2}`
  // Projects uses a brighter muted cyan-teal than the tent fabric. It remains
  // comfortably darker than true cyan, but no longer disappears into the aged
  // paper on headers, link/image highlights, and tool-page accents.
  const hoverColor = index === 2 ? '#3b8f91' : undefined
  const accentLuma = index === 2 ? 0.43 : undefined
  /** Distinguishes canvases painted for a prior prop identity even when the
      numerical spread happens to be the same. */
  const paintIdentity = `${index}\u0000${accent}`

  // Page turns are handled by the whole sheet, so the old printed "Back" and
  // "Next page" controls are deliberately omitted. The folios remain.
  const drawLeft = (ctx: CanvasRenderingContext2D, i: number, paper = false) =>
    paintPage(ctx, spreads[i].left, {
      side: 'left',
      accent,
      hoveredLink: hoveredLink.current?.side === 'left' ? hoveredLink.current.key : null,
      hoveredImage: hoveredImage.current?.side === 'left' ? hoveredImage.current.key : null,
      linkHoverMix: hoveredLink.current?.side === 'left' ? hoveredLink.current.mix : 0,
      imageHoverMix: hoveredImage.current?.side === 'left' ? hoveredImage.current.mix : 0,
      hoverColor,
      accentLuma,
      folio: folio(i * 2 + 1),
      jump:
        BOOK_SKIP_CONTROLS_ENABLED && i > 0
          ? { kind: 'first', to: 'book:0' }
          : undefined,
      seed: 101 + i * 7 + index * 31,
      paper,
      paperSeed: paperSeed.left,
    })

  const drawRight = (ctx: CanvasRenderingContext2D, i: number, paper = false) =>
    paintPage(ctx, spreads[i].right, {
      side: 'right',
      accent,
      hoveredLink: hoveredLink.current?.side === 'right' ? hoveredLink.current.key : null,
      hoveredImage: hoveredImage.current?.side === 'right' ? hoveredImage.current.key : null,
      linkHoverMix: hoveredLink.current?.side === 'right' ? hoveredLink.current.mix : 0,
      imageHoverMix: hoveredImage.current?.side === 'right' ? hoveredImage.current.mix : 0,
      hoverColor,
      accentLuma,
      folio: folio(i * 2 + 2),
      jump:
        BOOK_SKIP_CONTROLS_ENABLED && i < spreads.length - 1
          ? { kind: 'last', to: `book:${spreads.length - 1}` }
          : undefined,
      seed: 202 + i * 13 + index * 17,
      paper,
      paperSeed: paperSeed.right,
    })

  /**
   * Which spread each half of the block is currently showing.
   *
   * The two halves are not always showing the same one. During a turn the half
   * the sheet is lifting off has already been repainted with the page arriving
   * underneath — see `go` — so anything that repaints the block has to ask this
   * rather than assume both sides are on `spread`. It is a ref, not state,
   * because it changes inside an animation.
   */
  const shown = useRef({ left: 0, right: 0 })
  /** What is already resident in each stationary ink canvas. Page turns paint
      the destination before it is exposed, so the following React commit can
      republish its hit targets without drawing the same megapixel canvases a
      second time. */
  const painted = useRef<{ left: PaintedSide | null; right: PaintedSide | null }>({
    left: null,
    right: null,
  })

  /** Redraws one half from `shown`, and returns what the painter found on it. */
  const paintSide = (side: 'left' | 'right') => {
    if (side === 'left') {
      const l = drawLeft(leftInk.ctx, shown.current.left)
      leftInk.tex.needsUpdate = true
      painted.current.left = {
        spread: shown.current.left,
        identity: paintIdentity,
        page: l,
      }
      return l
    }
    const r = drawRight(rightInk.ctx, shown.current.right)
    rightInk.tex.needsUpdate = true
    painted.current.right = {
      spread: shown.current.right,
      identity: paintIdentity,
      page: r,
    }
    return r
  }

  /** Republishes controls from the pixels already painted into both blocks. */
  const publishPainted = () => {
    const l = painted.current.left?.page
    const r = painted.current.right?.page
    if (!l || !r) return false
    setHits([
      ...l.hits.map((hit) => ({ hit, side: 'left' as const })),
      ...r.hits.map((hit) => ({ hit, side: 'right' as const })),
    ])
    setPlates([
      ...l.images.map((hit) => ({ hit, side: 'left' as const })),
      ...r.images.map((hit) => ({ hit, side: 'right' as const })),
    ])
    return true
  }

  /** Repaints both visible pages and republishes the click targets. */
  const repaint = () => {
    paintSide('left')
    paintSide('right')
    publishPainted()
  }

  const setLinkHover = (hit: Hit, side: 'left' | 'right') => {
    const previous = hoveredLink.current
    if (previous?.key === hit.to && previous.side === side) {
      previous.target = 1
      return
    }
    hoveredLink.current = { key: hit.to, side, mix: 0, target: 1, painted: -1 }
    if (previous) paintSide(previous.side)
  }

  const clearLinkHover = (hit: Hit, side: 'left' | 'right') => {
    const current = hoveredLink.current
    if (!current || current.key !== hit.to || current.side !== side) return
    current.target = 0
  }

  const setImageHover = (hit: ImageHit, side: 'left' | 'right') => {
    const previous = hoveredImage.current
    if (previous?.key === hit.src && previous.side === side) {
      previous.target = 1
      return
    }
    hoveredImage.current = { key: hit.src, side, mix: 0, target: 1, painted: -1 }
    if (previous) paintSide(previous.side)
  }

  const clearImageHover = (hit: ImageHit, side: 'left' | 'right') => {
    const current = hoveredImage.current
    if (!current || current.key !== hit.src || current.side !== side) return
    current.target = 0
  }

  /** Advances one canvas-backed hover without allocating a temporary array in
      every frame of every mounted journal. */
  const advancePageHover = (
    hoverRef: { current: PageHoverTransition | null },
    dt: number
  ) => {
    const hover = hoverRef.current
    if (!hover) return
    hover.mix = THREE.MathUtils.lerp(hover.mix, hover.target, damp(hover.target ? 16 : 12, dt))
    const settled = Math.abs(hover.mix - hover.target) < 0.008
    if (Math.abs(hover.mix - hover.painted) >= 0.055 || settled) {
      hover.mix = settled ? hover.target : hover.mix
      hover.painted = hover.mix
      paintSide(hover.side)
    }
    if (hover.target === 0 && settled) hoverRef.current = null
  }

  useLayoutEffect(() => {
    // Dev-only: the folio is painted into the page texture, so which leaf the
    // journal is open at is invisible from outside the canvas. The end-to-end
    // probe in tools/probe-book.mjs reads this.
    if (import.meta.env.DEV) {
      // Only the journal the camera is at may claim the single-value handle —
      // all three are mounted the whole time, so an unguarded write is three
      // books fighting over one global. The per-journal map has no such
      // problem, and it is the one a probe can read *after* the reader has
      // walked out, which is where the reopen check has to look.
      const w = window as unknown as { __bookSpread?: number; __bookSpreads?: number[] }
      if (live) w.__bookSpread = spread
      ;(w.__bookSpreads ??= [])[index] = spread
    }

    // The paper itself is painted with its canvas, above; this only has to put
    // the writing on it. A completed turn has already painted both destination
    // halves before it commits `spread`, so reuse those exact pixels and only
    // republish their controls. Initialisation, a prop identity change, and the
    // put-away reset still take the full paint path.
    shown.current = { left: spread, right: spread }
    const left = painted.current.left
    const right = painted.current.right
    if (
      left?.spread === spread &&
      right?.spread === spread &&
      left.identity === paintIdentity &&
      right.identity === paintIdentity
    ) {
      publishPainted()
    } else {
      repaint()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spread, index, accent])

  // The cover does not depend on the open spread. Paint it once before the
  // first frame, then once more when its web fonts have actually landed.
  useLayoutEffect(() => {
    paintCover(
      coverPage.ctx,
      BOOK_TITLE[index] ?? 'Journal',
      BOOK_COVER_SUBTITLE[index] ?? 'FIELD NOTES',
      binding
    )
    coverPage.tex.needsUpdate = true
  }, [binding, coverPage, index])

  useLayoutEffect(() => {
    // Web fonts land after the first paint, so repaint once when they arrive
    // rather than blocking the whole scene on document.fonts.
    //
    // Through `shown`, not through `spread`: this callback closes over the
    // spread that was current when the effect ran, and if the fonts land
    // mid-turn — which on a cold cache they do — repainting from that closure
    // put the outgoing page straight back onto the half the sheet had just
    // uncovered. The page then appeared to change only once the sheet landed,
    // which is the whole complaint about the turn looking fake.
    // Prints land after the first paint the same way web fonts do, and for the
    // same reason: neither can be waited on from a layout effect. Every spread
    // in the book is fetched at once rather than only the open one, so turning
    // a page does not land on an empty plate.
    let alive = true
    if (imageSources.length > 0) {
      // Repainted per print rather than once at the end: the open spread's
      // picture is usually the first or second to land, and waiting on the
      // other seventeen before putting it up is a plate that stays empty for
      // several seconds while the reader looks straight at it.
      preloadBookImages(imageSources, (src) => {
        if (!alive) return
        const leftShown = spreads[shown.current.left]?.left
        const rightShown = spreads[shown.current.right]?.right
        if (leftShown && imagesIn(leftShown).includes(src)) paintSide('left')
        if (rightShown && imagesIn(rightShown).includes(src)) paintSide('right')
      }).then(() => {
        // Backstop. Every per-print repaint above is conditional on the print
        // belonging to a page that is open *at that moment*, and a source that
        // errors reports nothing at all. One unconditional pass once the whole
        // set has settled costs two canvas draws and closes both holes.
        if (!alive) return
        paintSide('left')
        paintSide('right')
      })
    }

    loadBookFonts().then(() => {
      if (!alive) return
      paintSide('left')
      paintSide('right')
      paintCover(
        coverPage.ctx,
        BOOK_TITLE[index] ?? 'Journal',
        BOOK_COVER_SUBTITLE[index] ?? 'FIELD NOTES',
        binding
      )
      coverPage.tex.needsUpdate = true
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSources, index, accent, binding])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    return () => {
      const w = window as unknown as {
        __bookSpreads?: unknown[]
        __books?: unknown[]
        __bookTurns?: unknown[]
        __bookHitRects?: unknown[]
        __bookHoverScale?: unknown[]
      }
      for (const entries of [
        w.__bookSpreads,
        w.__books,
        w.__bookTurns,
        w.__bookHitRects,
        w.__bookHoverScale,
      ]) {
        if (entries) delete entries[index]
      }
    }
  }, [index])

  // Reset only when the camera moves to a different tent's journal. Keyed on
  // `live` instead, leaving a tent wiped the ink the instant Escape was pressed
  // and the cover then closed over two blank pages — the reveal has its own
  // fast decay in useFrame, which is what should carry it out.
  useEffect(() => {
    if (enabled) return
    reveal.current = 0
    // A journal that is put down is closed, and a closed book is not left with
    // a finger in it: walking out and coming back should hand the reader the
    // first leaf, not the tool page they wandered off on. Done here rather
    // than on `live` because `enabled` only drops once the cover has finished
    // shutting — resetting on the way out would flip the pages in front of the
    // reader on their way through the tent flap.
    if (FROZEN_SPREAD === null) {
      setSpread(0)
      shown.current = { left: 0, right: 0 }
      turn.current = { t: 1, dir: 1, to: 0, mode: 'idle' }
      pageDrag.current = null
      dragEndpoint.current = null
    }
  }, [enabled])

  // Leaving the tent shuts the journal too — by Escape, by the door button, or
  // by walking out — and none of those go through `go`, so the sound has to be
  // hung off the journal going dark rather than off the control that did it.
  useEffect(() => {
    if (!live && openLevel.current > 0.05) sfxBookClose()
  }, [live])

  useEffect(() => {
    if (!enabled) {
      closedHovered.current = false
      onClosedHover(index, false)
    }
  }, [enabled, index, onClosedHover])

  const clearClosedHover = useCallback(() => {
    if (!closedHovered.current) return
    closedHovered.current = false
    document.body.classList.remove('camp-hover')
    onClosedHover(index, false)
  }, [index, onClosedHover])

  // Pointer-out can be missed when the canvas loses focus or the cover moves
  // under a stationary pointer during its hover scale. Clear ownership at the
  // DOM boundary as a final backstop, so neither scale nor outline can stick.
  useEffect(() => {
    const canvas = getThree().gl.domElement
    canvas.addEventListener('pointerleave', clearClosedHover)
    window.addEventListener('blur', clearClosedHover)
    return () => {
      canvas.removeEventListener('pointerleave', clearClosedHover)
      window.removeEventListener('blur', clearClosedHover)
    }
  }, [clearClosedHover, getThree])

  /**
   * Turns a leaf. The sheet carries the outgoing page on its front and the
   * incoming one on its back, so the swap underneath is never visible.
   */
  /**
   * A page's bounding rectangle on screen, in CSS pixels.
   *
   * Eight corners of the block projected through the camera, then the axis-
   * aligned box around them. The page is a shallow slab seen at an angle, so
   * its outline on screen is a quadrilateral — but the things that grow out of
   * it are rectangles, and a rectangle that covers the page is the honest
   * starting frame for one.
   *
   * `sub` narrows the result to a normalised rectangle on that page, which is
   * how a print's own footprint is found: the printed plate is a region of the
   * page, and a zoom that starts anywhere else does not read as a zoom.
   */
  const pageScreenRect = (
    side: 'left' | 'right' = 'right',
    sub?: Rect
  ): PageScreenRect | undefined => {
    const mesh = side === 'left' ? leftPage.current : rightPage.current
    if (!mesh) return undefined

    const geo = mesh.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const bb = geo.boundingBox
    if (!bb) return undefined

    const { camera, size } = getThree()

    mesh.updateWorldMatrix(true, false)

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const v = new THREE.Vector3()

    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z)
      v.applyMatrix4(mesh.matrixWorld).project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    const page = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    if (!sub) return page

    // Interpolated inside the projected box rather than projected properly.
    // From the reading pose the page is very nearly flat-on, so the error is a
    // few pixels — and this is the start of a 600ms move, not a hit target.
    return {
      x: page.x + page.w * sub.x0,
      y: page.y + page.h * sub.y0,
      w: page.w * (sub.x1 - sub.x0),
      h: page.h * (sub.y1 - sub.y0),
    }
  }

  /**
   * Acts on a link target.
   *
   * Shared by the printed links and by the prints that are links, because a
   * picture that opens the build and a line of text that opens the build should
   * not be two different pieces of routing.
   */
  const follow = (to: string, side: 'left' | 'right') => {
    // A contents entry. Handled in here rather than upstream: it moves the
    // book, and nothing outside the book knows how.
    if (to.startsWith('book:')) {
      const target = Number(to.slice(5))
      if (Number.isFinite(target)) goTo(target, target > spread ? 1 : -1)
      return
    }

    // Anything that leaves the site leaves in its own tab. The camp is a scene
    // the reader walked into; navigating it away to a storefront and back would
    // mean walking in again.
    if (to.startsWith('http') || to.startsWith('mailto:') || to.endsWith('.pdf')) {
      window.open(to, '_blank', 'noopener')
      return
    }

    onNavigate(to, pageScreenRect(side))
  }

  const go = (dir: 1 | -1) => goTo(spread + dir, dir)

  /** Paints both faces and exposes the turning leaf, without choosing how it moves. */
  const stageTurn = (to: number, dir: 1 | -1, mode: 'drag' | 'commit') => {
    if (turn.current.mode !== 'idle' || to < 0 || to >= spreads.length || to === spread) {
      return false
    }

    hoveredLink.current = null
    hoveredImage.current = null

    if (dir === 1) {
      drawRight(leafFront.ctx, spread, true)
      drawLeft(leafBack.ctx, to, true)
      shown.current.right = to
      paintSide('right')
    } else {
      drawLeft(leafFront.ctx, spread, true)
      drawRight(leafBack.ctx, to, true)
      shown.current.left = to
      paintSide('left')
    }
    leafFront.tex.needsUpdate = true
    leafBack.tex.needsUpdate = true
    turn.current = { t: 0, dir, to, mode }
    dragEndpoint.current = null
    setHits([])
    setPlates([])
    sfxPageTurn()
    return true
  }

  /**
   * Turns to a named spread. The contents page jumps several at once; the
   * full-page gesture steps by one. Either way a single sheet swings, carrying the
   * page being left on its front and the page being arrived at on its back —
   * turning eleven leaves one at a time to reach chapter eleven would be
   * honest and unwatchable.
   */
  const goTo = (to: number, dir: 1 | -1) => {
    if (turn.current.mode !== 'idle') return
    // Off either end of the deck — left page on the first spread, right page on
    // the last. There's nowhere left to turn to, so that page gesture shuts
    // the journal instead of doing nothing.
    if (to < 0 || to >= spreads.length) {
      sfxBookClose()
      onClose()
      return
    }
    if (to === spread) return
    // Front face: the page being taken away. Back face: the page arriving
    // underneath it, from the spread being turned to. Both painted with their
    // paper, because a sheet off the block has no block under it.
    //
    // And — this is the part that was missing — the block the sheet is lifting
    // *off* is repainted with the new page straight away. Physically the next
    // leaf is already lying there; it has been there the whole time. Leaving
    // the old page on it meant the reader watched the outgoing page slide over
    // a copy of itself and the content only changed once the sheet had landed,
    // which is exactly what makes a turn read as a texture swap rather than as
    // paper. The half the sheet is landing *on* keeps its old page until the
    // sheet covers it — the sheet's own back face is what replaces it.
    stageTurn(to, dir, 'commit')
  }

  const pointerX = (event: ThreeEvent<PointerEvent>) => event.nativeEvent.clientX

  const beginPageGesture = (side: 'left' | 'right', event: ThreeEvent<PointerEvent>) => {
    if (!armed || turn.current.mode !== 'idle') return
    event.stopPropagation()
    ;(event.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(
      event.pointerId
    )
    const dir: 1 | -1 = side === 'right' ? 1 : -1
    pageDrag.current = {
      pointerId: event.pointerId,
      startX: pointerX(event),
      dir,
      to: spread + dir,
      started: false,
      target: 0,
    }
  }

  const movePageGesture = (event: ThreeEvent<PointerEvent>) => {
    const drag = pageDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    const dx = pointerX(event) - drag.startX
    if (!drag.started && Math.abs(dx) >= 4) {
      drag.started = stageTurn(drag.to, drag.dir, 'drag')
    }
    if (!drag.started) return

    const span = Math.max(180, getThree().size.width * 0.28)
    drag.target = THREE.MathUtils.clamp((drag.dir === 1 ? -dx : dx) / span, 0, 1)
  }

  const endPageGesture = (event: ThreeEvent<PointerEvent>, cancelled = false) => {
    const drag = pageDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    ;(
      event.target as unknown as { releasePointerCapture: (id: number) => void }
    ).releasePointerCapture(event.pointerId)
    pageDrag.current = null

    if (!drag.started) {
      if (!cancelled) go(drag.dir)
      return
    }

    if (!cancelled && drag.target >= 0.28) {
      // Commit from the leaf's visible position, not the potentially distant
      // pointer target. A one-frame high-DPI swipe therefore finishes as a
      // readable authored turn instead of teleporting to the far block.
      turn.current.t = inverseTurnEase(turn.current.t)
      turn.current.mode = 'commit'
    } else {
      turn.current.mode = 'cancel'
    }
  }

  // Dev only — see FROZEN_TURN.
  useEffect(() => {
    if (FROZEN_TURN === null || !live) return
    const id = window.setTimeout(() => go(1), 1500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  // Keyboard paging: a book that only turns by clicking a corner is a book
  // nobody turns.
  useEffect(() => {
    if (!live) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, spread, spreads.length])

  /* ------------------------------------------------------------ animation */

  const HALF_W = 0.5 - PAGE_GUTTER
  /**
   * Height of the turning sheet's hinge.
   *
   * The paper at the fold, so that with the rest profile applied the sheet is
   * *coplanar* with the printed face it is lying on — the top leaf of that
   * block, which is what it is.
   *
   * It was the block's crest (`HINGE_Y`), 16mm higher. That is fine at either
   * end of the turn, where `uRest` is 1 and the rest profile puts every point
   * of the sheet back on the block anyway — but the profile fades out through
   * the swing, and what a fading profile leaves is a flat sheet through the
   * hinge. Hinged at the crest that flat sheet crosses the gutter 16mm up: the
   * page comes away from the binding mid-turn and hangs in the air over it,
   * still pivoting about the right line but not touching the book. Hinged at
   * the fold there is nothing to come away — the fold *is* the pivot, and the
   * rest profile (now measured from here too) is zero there at every stage of
   * the swing.
   *
   * It sat a further 5mm up, which sounds like nothing and is: 5mm of book is
   * about 2mm of the real object. But the reading camera looks along the page,
   * and 2mm of hover seen at that angle is a couple of millimetres of parallax
   * between the sheet and the book — the landed page sitting slightly off the
   * block it belongs to, with the fore edge showing under it. That is the
   * "separate object" in the last frames of the turn. Depth is handled by a
   * polygon offset on the material instead, which biases without moving.
   */
  const LEAF_Y = pageTopY('right', PAGE_GUTTER)
  /**
   * How far the sheet is allowed off the block *mid-swing*.
   *
   * Faded in and out with the swing, so it is a page being picked up rather
   * than a page teleporting a centimetre upward on frame one.
   */
  const LEAF_CLEARANCE = 0.007
  /** See the frame loop. */
  const FOLD_TUCK = PAGE_GUTTER + 0.026 + GUTTER - SQUARE * 0.5 + 0.002
  const SPINE_OFF = PAGE_GUTTER + HALF_W / 2

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const tu = turn.current

    if (
      !import.meta.env.DEV &&
      inactiveSettled.current &&
      !enabled &&
      !live &&
      !closedHot &&
      !closedHovered.current &&
      !armed &&
      reveal.current === 0 &&
      openLevel.current === 0 &&
      tu.mode === 'idle' &&
      pageDrag.current === null &&
      hoveredLink.current === null &&
      hoveredImage.current === null &&
      leaf.current?.visible === false &&
      Math.abs((hoverScale.current?.scale.x ?? width) / width - 1) < 1e-8
    ) {
      return
    }
    inactiveSettled.current = false

    // The page breathes with the candles while any page surface can be seen.
    // A journal admitted by the fast path above is fully shut and inactive, so
    // all three of these materials are hidden by the cover; when it becomes
    // active again this value is refreshed before the next render.
    const t = state.clock.elapsedTime
    const lamp = 0.93 + Math.sin(t * 3.1) * 0.05 + Math.sin(t * 7.7) * 0.025
    leftMat.material.emissiveIntensity = 0.16 * lamp
    rightMat.material.emissiveIntensity = 0.16 * lamp
    if (tu.mode === 'idle') leafMat.material.emissiveIntensity = 0.16 * lamp

    // Canvas ink cannot be tweened by CSS. Advance a small, quantized blend and
    // repaint only when it changes enough to be visible; this gives links and
    // photo mounts a smooth response without uploading a 796x1280 texture on
    // every high-refresh frame.
    advancePageHover(hoveredLink, dt)
    advancePageHover(hoveredImage, dt)

    // Opening: eased, with a little overshoot past flat — a stiff cover drops.
    const open = enabled ? openRef.current : 0
    openLevel.current = open
    const k = THREE.MathUtils.clamp(open, 0, 1)
    if (hoverScale.current) {
      // Scale and outline both receive `closedHot` from the same parent state,
      // so neither can lead or linger after the other.
      const target = closedHot && enabled && k < 0.05 ? 1.035 : 1
      const current = hoverScale.current.scale.x / width
      const next = THREE.MathUtils.lerp(current, target, damp(12, delta)) * width
      hoverScale.current.scale.setScalar(next)
    }
    const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
    const overshoot = Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.13 * (1 - k)
    if (hinge.current) {
      hinge.current.rotation.z = -Math.PI * (1 - eased) - overshoot
      /*
        Settle the flipped half onto the one underneath it.

        Each half is a wedge that crests near the spine, and the hinge sits on
        that crest — so rotated a half-turn the two halves touch at the crest
        and nowhere else. Everything from there to the fore edge opens into a
        void twice the bow deep, which is what made the shut journal look
        hollowed out through the middle of the text block.

        Dropping the hinged half by that same distance as it closes trades the
        gap for an overlap: the two blocks interpenetrate near the spine, where
        it is inside the book and invisible, and meet along the fore edge,
        where it is not. A closed book is a solid object; this is the cheapest
        way of it being one.
      */
      /*
        Cubed, not linear.

        The nest only has a job at the very end of the swing, where the two
        halves are face to face and have to interpenetrate rather than touch at
        the crest. Ramped linearly it is also a 2-3cm vertical translation
        applied through the *middle* of the swing — and a half that is standing
        near-vertical at the time gets slid down along its own length, which
        pulls its fold off the binding and opens a slot from the spine to the
        tent floor. That is the "one half floating, the two sides parted" frame.
        Cubing holds the drop near zero for the first three quarters of the
        swing and still reaches the same place at shut.
      */
      hinge.current.position.y = HINGE_Y - CLOSE_NEST * Math.pow(1 - eased, 3)
    }

    /**
     * How far the binding has to travel to be out of sight in the shut book.
     *
     * Enough to put the *widest* of the two — the gutter bridge, which runs out
     * to `PAGE_GUTTER + 0.026` either side of the fold — inboard of the shut
     * book's left edge at `GUTTER - SQUARE / 2`. A couple of millimetres over,
     * so nothing lands exactly on the edge.
     */
    if (spine.current) {
      spine.current.position.x = FOLD_TUCK * (1 - eased)
    }

    if (shift.current) {
      // A shut book sits where its right half is, so slide the whole thing as
      // the cover swings and both states stay centred on the same spot.
      shift.current.position.x = -0.25 * (1 - eased) * width
      shift.current.position.y = Math.sin(Math.PI * k) * 0.012
    }

    // Not gated on `open` any more: the reader shouldn't watch the ink fade
    // in after the cover is already lifted — the page is behind a closed
    // cover either way, so there is nothing lost by having it fully inked
    // before the cover swings, and the words are simply *there* the instant
    // it does.
    // Only ever written *on*, never unwritten. The decay that used to run here
    // meant a journal being put away spent its last half-second with the ink
    // draining off two pages the reader could still see — a book closing over
    // blank paper. A real one closes over what is written on it; the reset to
    // zero happens once the tent has gone dark and nothing is looking.
    if (live) reveal.current += (1 - reveal.current) * dt * 2.2
    let rv = live ? Math.min(1, reveal.current * 1.15) : reveal.current
    if (FROZEN_REVEAL !== null) rv = FROZEN_REVEAL
    leftMat.setReveal(rv)
    rightMat.setReveal(rv)

    if (tu.mode !== 'idle') {
      // Slower than it was. A page takes the better part of a second to fall
      // over, and at 0.54s the sheet crossed the spread faster than the eye
      // could read what was written on it.
      if (tu.mode === 'drag') {
        const drag = pageDrag.current
        if (drag) {
          const maxStep = MAX_DRAG_PROGRESS_PER_SECOND * dt
          tu.t += THREE.MathUtils.clamp(drag.target - tu.t, -maxStep, maxStep)
          tu.t = THREE.MathUtils.clamp(tu.t, 0, 1)
        }
      } else if (tu.mode === 'commit') {
        tu.t = Math.min(1, tu.t + dt * 1.15)
        if (FROZEN_TURN !== null) tu.t = FROZEN_TURN
      } else if (tu.mode === 'cancel') {
        tu.t = Math.max(0, tu.t - dt * 2.8)
      }
      // During a drag, progress chases the pointer linearly at the capped rate.
      // Autoplay retains the authored quadratic ease; release converts through
      // inverseTurnEase, so taking over never jumps.
      const e =
        tu.mode === 'drag' || tu.mode === 'cancel'
          ? tu.t
          : tu.t < 0.5
            ? 2 * tu.t * tu.t
            : 1 - Math.pow(-2 * tu.t + 2, 2) / 2
      /*
        The swing, brought down flat slightly early.

        An ease-out spends its tail creeping through the last degree or two of
        the rotation, and a sheet two degrees off the block is not two degrees
        of anything the eye reads — it is a page whose fore edge is a centimetre
        in the air, with the block's own fore edge showing past it underneath.
        That doubled edge, held for a tenth of a second while it converges, is
        the fault: it looks like a second sheet laid over the book rather than
        like the book's own paper coming down.

        Landing the rotation at 98.5% of the ease and holding it there costs
        nothing visible on the way over — it is a couple of percent of a swing
        that is mostly spent upright — and buys a real interval at the end
        where the sheet is exactly coplanar with the block it is lying on. By
        the time it stops being drawn there is nothing left to converge, so the
        hand-off is not a moment at all.
      */
      const er = Math.min(1, e / 0.985)
      // Forward, the sheet starts on the right half and swings anticlockwise;
      // backward it starts on the left and swings the other way. Rotating the
      // same starting side both ways is what used to drag the page down through
      // the bench on the way back.
      if (leafMesh.current) leafMesh.current.position.x = tu.dir * SPINE_OFF
      leafMat.setFrame(tu.dir, SPINE_OFF, HALF_W)
      // The flex. Lag peaks a little before the sheet is upright — paper is
      // slowest to catch up while it is still being lifted — and the rest
      // profile releases as the sheet leaves the block and comes back as it
      // lands on the other one.
      //
      // The lag has to be zero at both ends and never exceed the group's own
      // rotation on the way up: a fore edge that trails by more than the sheet
      // has turned is a fore edge *below* the block it is lying on, and it
      // clips straight through the paper.
      const swing = Math.sin(Math.PI * er)
      // Match the stationary blocks exactly. The shader's neutral exposure hold
      // handles the upright interval; increasing this warm emissive term during
      // the turn is what made the sheet become brown before snapping cream on
      // landing.
      leafMat.material.emissiveIntensity = 0.16 * lamp
      const lag = Math.min(0.55 * swing, Math.PI * er * 0.7, Math.PI * (1 - er) * 0.7)
      // The last argument turns the rest profile the right way up once the sheet
      // has gone over the top. See uFlip.
      leafMat.setFlex(lag, 0.055 * swing, 1 - swing, Math.cos(Math.PI * er))

      /*
        At a held endpoint the leaf and the page block occupy the same visible
        place, but they cannot be pixel-identical: the leaf is double-sided,
        bends in a shader, and selects its front/back canvas per fragment. Even
        with matched lights that left small differences in image contrast, ink,
        and the fore edge.

        Use the actual stationary block while the drag is exactly flat. The
        hidden page is restored/staged as the pointer enters or leaves an
        endpoint, so motion remains continuous while the two resting frames are
        now literally the same material and geometry as the idle book.
      */
      const endpoint =
        tu.mode === 'drag' ? (er <= 0.001 ? 'start' : er >= 0.999 ? 'end' : null) : null
      if (endpoint !== dragEndpoint.current) {
        const source = tu.dir === 1 ? 'right' : 'left'
        const landing = tu.dir === 1 ? 'left' : 'right'
        if (endpoint === 'start') {
          if (shown.current[source] !== spread) {
            shown.current[source] = spread
            paintSide(source)
          }
        } else if (endpoint === 'end') {
          if (shown.current[landing] !== tu.to) {
            shown.current[landing] = tu.to
            paintSide(landing)
          }
        } else if (tu.mode === 'drag') {
          if (shown.current[source] !== tu.to) {
            shown.current[source] = tu.to
            paintSide(source)
          }
          if (shown.current[landing] !== spread) {
            shown.current[landing] = spread
            paintSide(landing)
          }
        }
        dragEndpoint.current = endpoint
      }
      if (leaf.current) {
        leaf.current.visible = endpoint === null
        leaf.current.rotation.z = tu.dir * Math.PI * er
        // Off the block only while it is in the air. See LEAF_CLEARANCE.
        leaf.current.position.y = LEAF_Y + LEAF_CLEARANCE * swing
      }
      /*
        Hand the page to the block *before* the sheet finishes coming down.

        The half being landed on keeps its old page through the turn — the
        sheet's back face is what covers it. But a sheet a couple of degrees
        off the block does not cover it: the last of the rotation lifts the
        fore edge clear, and what shows underneath is a second page, with
        different words on it, sticking out past the one on top. Two stacked
        pages carrying two different texts is what makes the sheet read as a
        new object laid over the book instead of as the book's own paper —
        and it is at its worst in the last few frames, where the offset
        between them is small enough to look like a rendering fault rather
        than like one page above another.

        Past this point the sheet is all but flat and the only face of it
        anyone can see is its back — the page arriving. So the block can be
        given that same page now: whatever peeks out from under the sheet
        matches it, and there is nothing left to change when the sheet goes.
      */
      const landing = tu.dir === 1 ? 'left' : 'right'
      if (tu.mode === 'commit' && er >= 0.93 && shown.current[landing] !== tu.to) {
        shown.current[landing] = tu.to
        paintSide(landing)
      }
      // By here the sheet has been lying flush on the block, carrying the same
      // page as the block, for the tail of the ease — so this hides nothing the
      // reader can see going.
      if (tu.mode === 'commit' && tu.t >= 1) {
        if (shown.current[landing] !== tu.to) {
          shown.current[landing] = tu.to
          paintSide(landing)
        }
        if (leaf.current) leaf.current.visible = false
        tu.mode = 'idle'
        dragEndpoint.current = null
        setSpread(tu.to)
      } else if (tu.mode === 'cancel' && tu.t <= 0) {
        // Put both blocks back exactly as they were before the tentative drag.
        // The lifted sheet was only a preview; cancelling must not mutate the
        // spread or leave its hidden under-page staged for the next gesture.
        shown.current = { left: spread, right: spread }
        repaint()
        if (leaf.current) leaf.current.visible = false
        tu.t = 1
        tu.mode = 'idle'
        dragEndpoint.current = null
      }
    }

    // Dev-only: the three journals are supposed to be the same object in the
    // same place in three tents, and a framing difference between them is only
    // separable from a camera difference by reading both. See tools/qa/cam.mjs.
    if (import.meta.env.DEV && shift.current) {
      const w = window as unknown as {
        __books?: unknown[]
        __bookTurns?: unknown[]
        __bookHitRects?: unknown[][]
        __bookHoverScale?: number[]
      }
      ;(w.__books ??= [])[index] = {
        pos: shift.current.getWorldPosition(new THREE.Vector3()).toArray(),
        local: shift.current.position.toArray(),
        parent: shift.current.parent?.getWorldPosition(new THREE.Vector3()).toArray(),
        scale: shift.current.getWorldScale(new THREE.Vector3()).toArray(),
      }
      ;(w.__bookTurns ??= [])[index] = { ...tu }
      ;(w.__bookHoverScale ??= [])[index] = hoverScale.current
        ? hoverScale.current.scale.x / width
        : 1
      ;(w.__bookHitRects ??= [])[index] = hits.map(({ hit, side }) => ({
        to: hit.to,
        side,
        screen: pageScreenRect(side, hit),
      }))
    }

    // One state change per open and per close, rather than one a frame.
    const wantArmed = live && open > 0.9 && tu.mode === 'idle'
    if (wantArmed !== armed) setArmed(wantArmed)

    // `enabled` is dropped only once the cover has finished shutting. Record
    // that this full frame applied the final pose; subsequent production frames
    // can skip the invariant easing, transforms, reveal uniforms and arming
    // checks until any input becomes active again.
    inactiveSettled.current =
      !import.meta.env.DEV &&
      !enabled &&
      !live &&
      !closedHot &&
      !closedHovered.current &&
      !armed &&
      reveal.current === 0 &&
      openLevel.current === 0 &&
      tu.mode === 'idle' &&
      pageDrag.current === null &&
      hoveredLink.current === null &&
      hoveredImage.current === null &&
      leaf.current?.visible === false &&
      Math.abs((hoverScale.current?.scale.x ?? width) / width - 1) < 1e-8
  })

  /* --------------------------------------------------------------- render */

  // Controls on the printed surface are built as geometry that follows the
  // paper — see `buildPagePatch` and `PageMark`.

  return (
    <group position={position} rotation-y={rotationY}>
      <group ref={shift}>
        <group ref={hoverScale} scale={width}>
          {/* Right half stays put; the left half hangs on the spine hinge. */}
          {/* Casts, does not receive. The moon's map covers the whole camp at
              about three centimetres a texel, and a single texel edge crossing
              a board draws a hard band across the shut cover — the same
              artifact that was banding the open pages. */}
          <mesh geometry={parts.coverR} material={coverMat} castShadow />
          <mesh
            ref={rightPage}
            geometry={parts.right.geometry}
            material={[rightMat.material, edgeMat]}
            castShadow
          />
          {/*
            The binding — the spine arch and the gutter bridge — hung off a
            group of its own so it can be tucked away as the journal shuts.

            It bridges the gap between the two *open* boards, which is where it
            belongs and where it is invisible under the gutter. Shut, the left
            board folds onto the right one and the whole book slides half a
            spread to the right — and the spine, which does not move, is left
            standing out past the closed book's left edge as a pale grey tongue
            with nothing attached to it. The gutter bridge does the same, and
            further, since it was widened to stop the halves parting mid-swing.
            Sliding both under the right board over the same easing puts them
            out of sight for the one pose they have no business being seen in.
          */}
          <group ref={spine}>
            <mesh geometry={parts.spine} material={coverMat} castShadow />
            <mesh geometry={parts.gutter} material={gutterMat} />
          </group>
          <group ref={hinge} position={[0, HINGE_Y, 0]}>
            <group position={[0, -HINGE_Y, 0]}>
              {/* Hover ownership belongs to one mesh, not this multi-mesh
                  group. Group bubbling produced several over/out pairs from
                  the cover, page block and title plane and could leave the
                  scale/outline latched after rapid edge crossings. */}
              <mesh
                ref={setFrontCover}
                geometry={parts.coverL}
                material={coverMat}
                castShadow
                onPointerOver={(event) => {
                  event.stopPropagation()
                  const closed = enabled && openLevel.current < 0.05
                  closedHovered.current = closed
                  if (closed) document.body.classList.add('camp-hover')
                  onClosedHover(index, closed)
                }}
                onPointerOut={(event) => {
                  event.stopPropagation()
                  clearClosedHover()
                }}
                onPointerLeave={clearClosedHover}
                onPointerCancel={clearClosedHover}
                onClick={(e) => {
                  if (!enabled || openLevel.current >= 0.05) return
                  e.stopPropagation()
                  clearClosedHover()
                  // Reopening always starts at the beginning. The normal
                  // put-away reset runs after the exit animation; doing the
                  // same reset here is a final guard for a quick return or a
                  // journal closed from its own edge page inside the tent.
                  if (FROZEN_SPREAD === null) {
                    shown.current = { left: 0, right: 0 }
                    turn.current = { t: 1, dir: 1, to: 0, mode: 'idle' }
                    pageDrag.current = null
                    dragEndpoint.current = null
                    if (spread === 0) repaint()
                    else setSpread(0)
                  }
                  sfxBookOpen()
                  onOpenRequest()
                }}
              />
              <mesh
                ref={leftPage}
                geometry={parts.left.geometry}
                material={[leftMat.material, edgeMat]}
                castShadow
              />
              {/* Stamped title on the outside of the front board. Mirrored in
                  x, because this face is only ever seen from underneath once
                  the cover has flipped shut. */}
              <mesh
                raycast={() => null}
                position={[
                  -(GUTTER + (0.5 - GUTTER + SQUARE) / 2) + SQUARE * 0.5,
                  -0.0012,
                  0,
                ]}
                rotation={[Math.PI / 2, 0, 0]}
                scale={[-(0.5 - GUTTER + SQUARE) * 0.82, -(PAGE_DEPTH + SQUARE * 2) * 0.82, 1]}
              >
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial
                  map={coverPage.tex}
                  transparent
                  depthWrite={false}
                  toneMapped
                />
              </mesh>
            </group>
          </group>

          {/*
            The turning leaf: flat, because a page off the block is flat. Its
            hinge is the spine, and the group's rotation about Z is what carries
            it over the gutter.

            The quad is laid down — rotated a quarter turn about X — so it
            occupies the same plane the page block's printed face does. Without
            that it stands on edge: a `planeGeometry` is built in XY, so the
            sheet came up out of the book like a card in a pop-up and the
            "turning page" was a rectangle standing vertically over the spread.

            Its x offset follows the direction of travel (see the frame loop).
            Both directions have to sweep over the *top* of the book; a sheet
            that starts on the right and rotates negative goes down through the
            bench instead.
          */}
          <group ref={leaf} position={[0, LEAF_Y, 0]} visible={false}>
            <mesh
              ref={leafMesh}
              position={[SPINE_OFF, 0, 0]}
              rotation-x={-Math.PI / 2}
              material={leafMat.material}
              /* Lit by the room, but deliberately neither casting nor receiving
                 shadows. The stationary page blocks also do not receive the
                 camp's coarse shadow map. Letting only the moving leaf receive
                 it made the sheet darken at exactly 0% and 100% while a drag
                 was still held, then snap back when release hid the leaf. */
              /* Enough segments across the sheet for the curl to be a curve
                 rather than a fold. The old 14 was sized for a bend that only
                 had to bow the middle; a lag that grows toward the fore edge
                 needs the density out there. */
              frustumCulled={false}
            >
              <planeGeometry args={[HALF_W, PAGE_DEPTH, 32, 2]} />
            </mesh>
          </group>

          {/* Full-sheet gestures sit a hair below links and image plates. Those
              marks stop propagation, so their authored action wins; all
              unclaimed paper clicks or drags arrive here. */}
          <PageGesture
            side="left"
            onPointerDown={(event) => beginPageGesture('left', event)}
            onPointerMove={movePageGesture}
            onPointerUp={endPageGesture}
            onPointerCancel={(event) => endPageGesture(event, true)}
          />
          <PageGesture
            side="right"
            onPointerDown={(event) => beginPageGesture('right', event)}
            onPointerMove={movePageGesture}
            onPointerUp={endPageGesture}
            onPointerCancel={(event) => endPageGesture(event, true)}
          />

          {armed &&
            hits.map(({ hit, side }, i) => (
              <PageMark
                key={`${hit.to}-${i}`}
                side={side}
                rect={hit}
                onOver={() => setLinkHover(hit, side)}
                onOut={() => clearLinkHover(hit, side)}
                onClick={() => follow(hit.to, side)}
              />
            ))}

          {/* The prints. Every one is pressable: a plate with somewhere to go
              follows it, and a plate without one opens the uncropped picture,
              which is the only way to actually read a screenshot printed at
              the size a page allows. */}
          {armed &&
            plates.map(({ hit, side }, i) => (
              <PageMark
                key={`img-${hit.src}-${i}`}
                side={side}
                rect={hit}
                cursor="zoom"
                onOver={() => setImageHover(hit, side)}
                onOut={() => clearImageHover(hit, side)}
                onClick={() => {
                  if (hit.to) {
                    follow(hit.to, side)
                    return
                  }
                  const from = pageScreenRect(side, hit)
                  if (from) onZoom?.(hit.zoom ?? hit.src, from)
                }}
              />
            ))}

        </group>
      </group>
    </group>
  )
}
/** Invisible, curved hit surface covering one entire open page. */
function PageGesture({
  side,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  side: 'left' | 'right'
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void
  onPointerCancel: (event: ThreeEvent<PointerEvent>) => void
}) {
  const geometry = useMemo(() => buildPagePatch(side, FULL_PAGE_RECT, 18, 0.0001), [side])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        colorWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
/**
 * An invisible hover/click target lying on the printed surface. Its feedback is
 * repainted into the page canvas: link glyphs change ink, while an image's
 * already-existing paper mount changes colour outside the print.
 *
 * The geometry follows the paper's curve — see `buildPagePatch`.
 */
function PageMark({
  side,
  rect,
  cursor = 'hand',
  onOver,
  onOut,
  onClick,
}: {
  side: 'left' | 'right'
  rect: Rect
  /**
   * What the pointer becomes over this mark.
   *
   * A link and a picture you can open are both pressable, but they are not the
   * same offer, and the ring in the middle of the screen is the only thing on
   * this page that can say which is which.
   */
  cursor?: 'hand' | 'zoom'
  onOver: () => void
  onOut: () => void
  onClick: () => void
}) {
  const geometry = useMemo(() => buildPagePatch(side, rect), [side, rect])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      renderOrder={2}
      onPointerOver={(e) => {
        e.stopPropagation()
        onOver()
        document.body.classList.add(cursor === 'zoom' ? 'camp-zoom' : 'camp-hover')
      }}
      onPointerOut={() => {
        onOut()
        document.body.classList.remove('camp-hover')
        document.body.classList.remove('camp-zoom')
      }}
      // Reserve the entire press sequence for the printed control. Without
      // these, pointer-down bubbled to the full-page drag surface and captured
      // the pointer before this mark's click could fire.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  )
}
