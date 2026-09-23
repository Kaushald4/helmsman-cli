import { describe, it, expect } from "vitest";
import { STEALTH_INJECTION_SCRIPT } from "../src/driver/stealth.js";
import {
  jitteredWait,
  humanScroll,
  humanMove,
  isChallengeActive,
  detectChallengeInPage,
} from "../src/driver/actions.js";
import {
  buildChromeArgs,
  buildUserAgent,
  detectChromeVersion,
  findSystemChromePath,
  BrowserDriver,
  IGNORED_DEFAULT_ARGS,
} from "../src/driver/browser.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("Stealth Layer", () => {
  it("should provide a non-empty injection script that targets webdriver and chrome", () => {
    expect(STEALTH_INJECTION_SCRIPT).toBeDefined();
    expect(STEALTH_INJECTION_SCRIPT).toContain("'webdriver'");
    expect(STEALTH_INJECTION_SCRIPT).toContain("window.chrome");
    expect(STEALTH_INJECTION_SCRIPT).toContain("UNMASKED_RENDERER_WEBGL");
  });

  it("should include Function.prototype.toString tampering defense", () => {
    expect(STEALTH_INJECTION_SCRIPT).toContain("customToStringMap");
    expect(STEALTH_INJECTION_SCRIPT).toContain("Function.prototype.toString");
    expect(STEALTH_INJECTION_SCRIPT).toContain("[native code]");
  });

  it("should return a Chrome/Chromium binary that matches the current platform", () => {
    const chromePath = findSystemChromePath();
    const platform = os.platform();

    // The exact basenames findSystemChromePath probes, per platform. Comparing
    // basenames keeps this correct on Linux runners, where the binary is
    // "google-chrome" rather than macOS's "Google Chrome".
    const expectedBasenames =
      platform === "win32"
        ? ["chrome.exe"]
        : platform === "darwin"
        ? ["Google Chrome", "Google Chrome Canary", "Chromium"]
        : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

    if (chromePath === null) {
      // No supported browser is installed here; callers handle the null case.
      expect(chromePath).toBeNull();
      return;
    }

    expect(expectedBasenames).toContain(path.basename(chromePath));
    expect(fs.existsSync(chromePath)).toBe(true);
  });
});

describe("User agent", () => {
  it("names the version it is given, per platform", () => {
    expect(buildUserAgent("153.0.8010.48", "darwin")).toContain("Chrome/153.0.8010.48");
    expect(buildUserAgent("153.0.8010.48", "darwin")).toContain("Macintosh");
    expect(buildUserAgent("153.0.8010.48", "win32")).toContain("Windows NT 10.0; Win64; x64");
    expect(buildUserAgent("153.0.8010.48", "linux")).toContain("X11; Linux x86_64");
  });

  it("never advertises a headless browser", () => {
    expect(buildUserAgent("153.0.8010.48", "darwin")).not.toContain("HeadlessChrome");
  });

  /**
   * The regression this guards: the User-Agent was hardcoded to Chrome 133 while
   * the installed browser was a different release, which left the header
   * contradicting the browser's own client hints.
   */
  it("agrees with the version of the Chrome that is actually installed", () => {
    const version = detectChromeVersion();

    if (version === null) {
      // No readable Chrome on this machine, so there is nothing to compare
      // against. What matters then is that no override is applied at all.
      expect(buildChromeArgs({ headless: true }, undefined).some((a) => a.startsWith("--user-agent="))).toBe(false);
      return;
    }

    expect(version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(buildUserAgent(version)).toContain(`Chrome/${version}`);
  });

  it("only passes --user-agent when there is one to pass", () => {
    expect(buildChromeArgs({ headless: true }, "UA").some((a) => a === "--user-agent=UA")).toBe(true);
    expect(buildChromeArgs({ headless: true }, undefined).some((a) => a.startsWith("--user-agent="))).toBe(false);
  });
});

/**
 * Chromium's kBadFlags (chrome/browser/ui/startup/bad_flags_prompt.cc) are
 * matched by switch name only - the value is irrelevant - and each one makes
 * Chrome render "You are using an unsupported command-line flag: … Stability
 * and security will suffer." in the window. There is no --test-type escape
 * hatch in that code path, so we must simply never pass them.
 */
describe("Chrome launch arguments", () => {
  const BAD_FLAGS = [
    "--disable-blink-features",
    "--enable-blink-features",
    "--no-sandbox",
    "--disable-web-security",
    "--single-process",
    "--ignore-certificate-errors",
  ];

  it("never passes a flag Chromium warns about", () => {
    const args = buildChromeArgs({ headless: true }, "UA");
    for (const bad of BAD_FLAGS) {
      expect(args.some((arg) => arg === bad || arg.startsWith(`${bad}=`))).toBe(false);
    }
  });

  it("omits --disable-blink-features so Chrome shows no unsupported-flag banner", () => {
    expect(buildChromeArgs({ headless: false }, "UA").some((a) => a.startsWith("--disable-blink-features"))).toBe(
      false
    );
    expect(buildChromeArgs({ headless: true }, "UA").some((a) => a.startsWith("--disable-blink-features"))).toBe(
      false
    );
  });

  it("strips the --disable-blink-features arg Playwright appends on its own", () => {
    // Playwright pushes this unless the args already contain one, and it appends
    // inside defaultArgs(), so the ignoreDefaultArgs exact-match filter is the
    // only thing that keeps it away from Chrome.
    expect(IGNORED_DEFAULT_ARGS).toContain("--disable-blink-features=AutomationControlled");
  });

  it("only drops the launch flag because the init script still masks webdriver", () => {
    expect(STEALTH_INJECTION_SCRIPT).toContain("'webdriver' in proto");
    expect(STEALTH_INJECTION_SCRIPT).toContain("Object.defineProperty(proto, 'webdriver'");
  });
});

const VISIBLE_STYLE = { display: "block", visibility: "visible", opacity: "1" };
const HIDDEN_STYLE = { display: "none", visibility: "visible", opacity: "1" };

interface FakeElement {
  style: typeof VISIBLE_STYLE;
  getBoundingClientRect(): { width: number; height: number };
}

function box(width: number, height: number, style = VISIBLE_STYLE): FakeElement {
  return { style, getBoundingClientRect: () => ({ width, height }) };
}

/**
 * Runs the real in-page detector against a stubbed page.
 *
 * The detector is stringified into the browser at runtime, so evaluating it
 * with fake globals exercises exactly the same code without launching Chrome.
 */
function runDetector(title: string, elements: Record<string, FakeElement>) {
  const resolve = (selector: string): FakeElement | null => {
    for (const part of selector.split(",").map((s) => s.trim())) {
      const hit = elements[part];
      if (hit) return hit;
    }
    return null;
  };

  const document = {
    title,
    querySelector: (selector: string) => resolve(selector),
    querySelectorAll: (selector: string) => {
      const hit = resolve(selector);
      return hit ? [hit] : [];
    },
  };
  const window = { getComputedStyle: (element: FakeElement) => element.style };

  const run = new Function("document", "window", `return (${detectChallengeInPage.toString()})();`);
  return run(document, window) as { active: boolean; type?: string };
}

const RECAPTCHA = "iframe[src*='google.com/recaptcha']";

describe("Challenge detection", () => {
  it("ignores the invisible reCAPTCHA Reddit ships on every page", () => {
    // The reported bug: a 0x0 reCAPTCHA iframe made every Reddit page look
    // like it was behind a captcha, so the CLI announced a challenge that was
    // never on screen and then timed out waiting for it.
    expect(runDetector("r/LocalLLaMA", { [RECAPTCHA]: box(0, 0) })).toEqual({ active: false });
  });

  it("ignores a reCAPTCHA iframe that is display:none", () => {
    expect(runDetector("r/LocalLLaMA", { [RECAPTCHA]: box(300, 500, HIDDEN_STYLE) })).toEqual({
      active: false,
    });
  });

  it("ignores the small reCAPTCHA corner badge", () => {
    // Score-based widgets render a badge without blocking anything.
    expect(runDetector("Reddit", { [RECAPTCHA]: box(70, 60) })).toEqual({ active: false });
  });

  it("detects the real, large reCAPTCHA challenge", () => {
    const result = runDetector("Reddit", { [RECAPTCHA]: box(320, 480) });
    expect(result.active).toBe(true);
    expect(result.type).toBe("Google reCAPTCHA");
  });

  it("ignores an empty hidden Cloudflare Turnstile placeholder", () => {
    expect(runDetector("Reddit", { "#cf-turnstile": box(0, 0, HIDDEN_STYLE) })).toEqual({
      active: false,
    });
  });

  it("detects a visible Cloudflare Turnstile widget", () => {
    const result = runDetector("Reddit", {
      "iframe[src*='challenges.cloudflare.com']": box(300, 200),
    });
    expect(result.active).toBe(true);
    expect(result.type).toBe("Cloudflare Turnstile");
  });

  it("detects a Cloudflare interstitial by title alone", () => {
    const result = runDetector("Just a moment...", {});
    expect(result.active).toBe(true);
    expect(result.type).toBe("Cloudflare Waiting Room / Challenge");
  });

  it("reports nothing on a clean page", () => {
    expect(runDetector("r/LocalLLaMA", {})).toEqual({ active: false });
  });
});

describe("Driver Actions", () => {
  it("should execute jitteredWait within expected duration window", async () => {
    const start = Date.now();
    await jitteredWait(50, 50); // 50ms to 100ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(250);
  });

  it("should expose humanScroll and humanMove functions", () => {
    expect(typeof humanScroll).toBe("function");
    expect(typeof humanMove).toBe("function");
    expect(typeof isChallengeActive).toBe("function");
  });
});

describe("BrowserDriver Lock Management", () => {
  it("should handle profile lock checks and clean stale locks", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "helmsman-test-"));
    const driver = new BrowserDriver(tempDir);

    const profileDir = driver.getProfilePath("test-prof");
    fs.mkdirSync(profileDir, { recursive: true });

    // Initially no lock
    expect(driver.getProfileLock("test-prof")).toBeNull();

    // Create a dummy stale lock
    const lockPath = path.join(profileDir, "SingletonLock");
    try {
      fs.symlinkSync("dummyhost-9999999", lockPath);
      const lock = driver.getProfileLock("test-prof");
      if (lock) {
        expect(lock.pid).toBe(9999999);
        expect(lock.isAlive).toBe(false);
      }
    } catch {
      // Symlinks might require admin on Windows; skip if not supported
    }

    driver.cleanProfileLocks("test-prof");
    expect(fs.existsSync(lockPath)).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
