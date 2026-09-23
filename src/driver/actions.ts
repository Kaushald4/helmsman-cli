import type { Page, Locator } from "playwright-core";

export interface ScrollCollectOptions {
  maxRounds?: number;
  targetCount?: number;
  jitterBaseMs?: number;
  jitterRangeMs?: number;
  consecutiveEmptyStops?: number;
}

/**
 * Introduces a randomized delay to avoid exact, unchanging automation timings.
 */
export function jitteredWait(baseMs = 400, jitterMs = 300): Promise<void> {
  const delay = baseMs + Math.random() * jitterMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Scrolls using synthetic mouse wheel events with non-linear velocity and micro-jitter,
 * generating trusted browser 'wheel' and 'scroll' events to satisfy anti-bot telemetry.
 */
export async function humanScroll(
  page: Page,
  totalDeltaY = 500,
  slices = 5,
): Promise<void> {
  const baseDelta = totalDeltaY / slices;
  for (let i = 0; i < slices; i++) {
    // Introduce human acceleration and deceleration
    const multiplier = 0.7 + Math.random() * 0.6;
    const deltaY = Math.round(baseDelta * multiplier);
    await page.mouse.wheel(0, deltaY);
    await jitteredWait(50, 70);
  }
}

/**
 * Emulates human-like scrolling across virtualized feeds.
 */
export async function scrollLikeAPersonWould(
  page: Page,
  slices = 3,
): Promise<void> {
  for (let i = 0; i < slices; i++) {
    const scrollAmount = Math.round(300 + Math.random() * 350);
    await humanScroll(page, scrollAmount, 4);
    await jitteredWait(150, 200);
  }
}

/**
 * Moves the mouse cursor along intermediate steps with realistic jitter.
 */
export async function humanMove(
  page: Page,
  targetX: number,
  targetY: number,
  steps = 15,
): Promise<void> {
  await page.mouse.move(targetX, targetY, { steps });
  await jitteredWait(50, 100);
}

/**
 * Types text with realistic, variable inter-keystroke intervals (mimicking human typing).
 */
export async function humanType(
  page: Page,
  selectorOrLocator: string | Locator,
  text: string,
): Promise<void> {
  const locator = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator) : selectorOrLocator;
  await locator.focus();

  for (const char of text) {
    await page.keyboard.type(char);

    // Human typing variance: pauses slightly on spaces and punctuation
    let delay = 35 + Math.random() * 65;
    if (char === " " || char === "." || char === ",") {
      delay += 80 + Math.random() * 120;
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}

/**
 * Evaluates a browser-injected function within the page context.
 */
export async function evaluateInjected<T>(page: Page, fn: () => T): Promise<T> {
  return page.evaluate<T>(`(${fn.toString()})()`);
}

/**
 * Runs inside the page: reports the first *visible* anti-bot challenge.
 *
 * Visibility is the whole point. Counting matching nodes reported a challenge
 * on pages where nothing was on screen, because these markers are routinely
 * present but inert:
 *   - Reddit ships an invisible reCAPTCHA iframe on every page (it belongs to
 *     its own login flow, not to whatever page you are reading).
 *   - reCAPTCHA also renders a small corner badge for score-based widgets.
 *   - Cloudflare renders an empty, usually hidden `#cf-turnstile` placeholder
 *     unless it actually decides to challenge.
 * Only a challenge that is on screen and large enough to be interacted with
 * blocks automation, so each candidate must have a real bounding box.
 */
export function detectChallengeInPage(): { active: boolean; type?: string } {
  const MIN_SIDE = 40;

  const visibleBox = (element: Element | null): DOMRect | null => {
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) return null;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return null;
    if (parseFloat(style.opacity || "1") < 0.05) return null;

    return rect;
  };

  const title = document.title || "";
  if (/just a moment\.\.\./i.test(title) || /attention required/i.test(title)) {
    return { active: true, type: "Cloudflare Waiting Room / Challenge" };
  }

  if (
    visibleBox(document.querySelector("iframe[src*='challenges.cloudflare.com']")) ||
    visibleBox(document.querySelector("#cf-turnstile, .cf-turnstile"))
  ) {
    return { active: true, type: "Cloudflare Turnstile" };
  }

  if (
    visibleBox(
      document.querySelector("iframe[src*='datadome'], iframe[src*='geo.captcha-delivery.com']")
    )
  ) {
    return { active: true, type: "DataDome Interstitial" };
  }

  // The blocking reCAPTCHA is the large centred challenge iframe. The
  // invisible widget and the corner badge are both far smaller, and the
  // invisible variant is frequently 0x0 or display:none.
  const recaptchaFrames = Array.from(
    document.querySelectorAll("iframe[src*='google.com/recaptcha']")
  );
  const blockingRecaptcha = recaptchaFrames.some((frame) => {
    const rect = visibleBox(frame);
    return rect !== null && rect.width >= 160 && rect.height >= 100;
  });
  if (blockingRecaptcha) {
    return { active: true, type: "Google reCAPTCHA" };
  }

  return { active: false };
}

/**
 * Detects whether an active anti-bot challenge (Cloudflare, DataDome, reCAPTCHA, Arkose) is blocking the page.
 */
export async function isChallengeActive(page: Page): Promise<{ active: boolean; type?: string }> {
  try {
    const result = await evaluateInjected(page, detectChallengeInPage);
    return result ?? { active: false };
  } catch {
    return { active: false };
  }
}

/**
 * Pauses execution if a challenge is detected, allowing a human to intervene and solve it in the headed window.
 */
export async function waitForChallengeResolution(page: Page, maxWaitMs = 60000): Promise<boolean> {
  const initial = await isChallengeActive(page);
  if (!initial.active) return true;

  console.warn(`\n⚠️  [Bot Detection] Detected ${initial.type}!`);
  console.warn(`Please complete the challenge in the open browser window. Waiting up to ${Math.round(maxWaitMs / 1000)}s for resolution...\n`);

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await jitteredWait(1000, 500);
    const check = await isChallengeActive(page);
    if (!check.active) {
      console.log(`✅ [Bot Detection] Challenge cleared! Continuing automation...\n`);
      return true;
    }
  }

  throw new Error(`Timed out waiting for ${initial.type} challenge to be resolved.`);
}

/**
 * The core virtualized-feed extraction loop:
 * Scrolls repeatedly while accumulating DISTINCT items across every round,
 * preventing data loss on virtualized lists (Twitter/X, Reddit, LinkedIn)
 * where scrolled-off items are unmounted from the DOM.
 */
export async function scrollCollectDedupe<T>(
  page: Page,
  extractFn: () => T[] | Promise<T[]>,
  keyOf: (item: T) => string,
  options: ScrollCollectOptions = {},
): Promise<T[]> {
  const maxRounds = options.maxRounds ?? 10;
  const targetCount = options.targetCount ?? Infinity;
  const baseDelay = options.jitterBaseMs ?? 500;
  const jitterDelay = options.jitterRangeMs ?? 400;
  const emptyStopThreshold = options.consecutiveEmptyStops ?? 3;

  const seen = new Map<string, T>();
  let consecutiveZeroRounds = 0;

  const collect = async (): Promise<number> => {
    let raw: T[];
    if (typeof extractFn === "function") {
      try {
        if (extractFn.length >= 1) {
          raw = await (extractFn as any)(page);
        } else {
          raw = await page.evaluate(extractFn);
        }
      } catch {
        try {
          raw = await page.evaluate(extractFn);
        } catch {
          raw = [];
        }
      }
    } else {
      raw = [];
    }

    let newlyAdded = 0;
    for (const item of raw) {
      if (!item) continue;
      const key = keyOf(item);
      if (!key) continue;
      if (!seen.has(key)) {
        seen.set(key, item);
        newlyAdded++;
      }
    }
    return newlyAdded;
  };

  // Initial collection before scrolling
  await collect();

  for (let round = 0; round < maxRounds; round++) {
    if (seen.size >= targetCount) break;

    // Check if challenge appeared during scrolling
    const challenge = await isChallengeActive(page);
    if (challenge.active) {
      await waitForChallengeResolution(page);
    }

    await scrollLikeAPersonWould(page);
    await jitteredWait(baseDelay, jitterDelay);

    const added = await collect();
    if (added === 0) {
      consecutiveZeroRounds++;
      if (consecutiveZeroRounds >= emptyStopThreshold) {
        break; // No more items loading
      }
    } else {
      consecutiveZeroRounds = 0;
    }
  }

  return Array.from(seen.values()).slice(0, targetCount);
}
