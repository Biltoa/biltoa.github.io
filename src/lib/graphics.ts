/**
 * Mobile is an explicit rendering mode, not merely a narrow browser window.
 * That keeps desktop output byte-for-byte on its existing 1x baseline while
 * allowing high-density phones to render legible journal ink.
 *
 * `?mobile=1` is a development-only hook for the deterministic 390x844 / 844x390
 * browser QA harness on machines that do not expose a coarse touch pointer.
 */
const MOBILE_QA_OVERRIDE =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mobile') === '1'

export const MOBILE_EXPERIENCE =
  typeof window !== 'undefined' &&
  (MOBILE_QA_OVERRIDE ||
    /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent) ||
    (/Macintosh/i.test(window.navigator.userAgent) && window.navigator.maxTouchPoints > 1))

/**
 * An iPhone-sized viewport is inexpensive at 2x (about 1.3 million pixels),
 * while blindly using the device's full 3x DPR would make every half-float
 * post-processing target nine times the old area. Larger touch screens stay at
 * 1.5x for the same reason. Desktop remains exactly 1x.
 */
const mobilePixelBudget =
  typeof window === 'undefined' ? 0 : window.innerWidth * window.innerHeight
const mobileDprCap = mobilePixelBudget <= 420_000 ? 2 : 1.5

export const GRAPHICS_DPR = MOBILE_EXPERIENCE
  ? Math.min(mobileDprCap, Math.max(MOBILE_QA_OVERRIDE ? 2 : 1, window.devicePixelRatio))
  : 1
