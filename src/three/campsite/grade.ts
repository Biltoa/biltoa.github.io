import { BlendFunction, Effect } from 'postprocessing'
import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*  Split toning: cool the shadows, warm the highlights.                        */
/* -------------------------------------------------------------------------- */

/**
 * The one grade a night scene most wants and the stock passes cannot give.
 *
 * `HueSaturation` and `BrightnessContrast` act on every pixel equally, so
 * pushing the frame bluer to get moonlit shadows also pulls the fire toward
 * blue, and warming it to save the fire warms the shadows straight back to the
 * brown the whole pass was trying to remove. Splitting the two by luminance is
 * what lets both ends move in opposite directions at once — cold blue in the
 * dark half, orange in the hot half — which is most of what reads as
 * "cinematic" in the reference frames.
 *
 * Deliberately restrained: these are tints added to a value, not a LUT. The
 * strengths below move the ends by a few percent, which is enough for the eye
 * to separate the two light sources and small enough that nothing takes a cast.
 */
const FRAG = /* glsl */ `
  uniform vec3 uShadow;
  uniform vec3 uHighlight;
  uniform float uShadowAmount;
  uniform float uHighlightAmount;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

    // Shadow tint weighted to the bottom of the range, highlight tint to the
    // top, with a gap in the middle so mid-tones — which is most of the tent
    // fabric — keep their own colour.
    float shadow = 1.0 - smoothstep(0.0, 0.42, lum);
    float highlight = smoothstep(0.46, 1.0, lum);

    c += uShadow * shadow * uShadowAmount;
    c += uHighlight * highlight * uHighlightAmount;

    outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
  }
`

export interface SplitToneOptions {
  shadow?: THREE.Color
  highlight?: THREE.Color
  shadowAmount?: number
  highlightAmount?: number
}

/**
 * Tints only. Saturation belongs to `HueSaturation`, which is already in the
 * chain — and the two must not both do it.
 *
 * This pass runs on the composer's linear working buffer, *before* tone
 * mapping, where a lit surface is a value like 8 and a dim one is 0.03. A
 * saturation term written the usual way — `mix(vec3(luma), rgb, k)` with k
 * above 1 — is a subtraction on the channels below the mean, and at those
 * magnitudes it drives them straight through zero: the whole warm half of a
 * frame clipped to black while the highlights, already near the top, survived.
 * The same code after tone mapping would have been unremarkable. Additive tints
 * have no such failure mode, which is why they are all that is left here.
 */
export class SplitToneEffect extends Effect {
  constructor({
    shadow = new THREE.Color('#2c56b4'),
    highlight = new THREE.Color('#ff9a3c'),
    shadowAmount = 0.048,
    highlightAmount = 0.06,
  }: SplitToneOptions = {}) {
    super('SplitToneEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uShadow', new THREE.Uniform(shadow)],
        ['uHighlight', new THREE.Uniform(highlight)],
        ['uShadowAmount', new THREE.Uniform(shadowAmount)],
        ['uHighlightAmount', new THREE.Uniform(highlightAmount)],
      ]),
    })
  }
}
