import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { applyStealth } from "./stealth.js";

export interface LaunchOptions {
  headless?: boolean;
  endpoint?: string; // Optional remote CDP endpoint (e.g. ws://127.0.0.1:9222/...)
  viewport?: { width: number; height: number } | null;
  userAgent?: string;
  killExisting?: boolean; // If true (default), terminates any existing process locking this profile
}

/**
 * Flags we pass to Chrome.
 *
 * Deliberately contains no `--disable-blink-features`. Chromium lists
 * `disable-blink-features` in `kBadFlags` (chrome/browser/ui/startup/
 * bad_flags_prompt.cc) and matches it by switch name, ignoring the value - so
 * ANY use of it makes Chrome display "You are using an unsupported
 * command-line flag: --disable-blink-features=AutomationControlled. Stability
 * and security will suffer." in the window. There is no `--test-type` escape
 * hatch in that code path, so the only way to keep the banner out of a visible
 * session is to not pass the switch at all.
 *
 * It is also unnecessary: Playwright appends
 * `--disable-blink-features=AutomationControlled` itself, and the stealth
 * init script pins `navigator.webdriver` to `false` at the prototype level
 * (see STEALTH_INJECTION_SCRIPT section 2). We drop Playwright's copy via
 * IGNORED_DEFAULT_ARGS instead, so the masking still works and the banner
 * never appears.
 */
export const CHROME_ARGS: readonly string[] = [
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-infobars",
  "--disable-notifications",
  "--window-size=1280,800",
];

/**
 * Playwright defaults (and args it appends on our behalf) that we strip.
 *
 * `ignoreDefaultArgs` is applied as an exact-match filter over the final
 * argument list, and Playwright appends its `--disable-blink-features=
 * AutomationControlled` inside `defaultArgs()`. Listing it here is therefore
 * the only way to stop it reaching Chrome.
 */
export const IGNORED_DEFAULT_ARGS: readonly string[] = [
  "--enable-automation", // Removes the 'Chrome is being controlled by automated software' infobar
  "--no-sandbox", // Prevents Playwright from injecting --no-sandbox
  "--disable-extensions", // Allows regular extensions to function
  "--enable-unsafe-swiftshader", // Avoids revealing CPU-based software renderer
  "--use-mock-keychain", // Uses native platform keychain
  "--password-store=basic", // Prevents forced mock password storage flag
  "--disable-blink-features=AutomationControlled", // See CHROME_ARGS - Chromium banners on this switch
];

/** Builds the full Chrome argument list for a launch. */
export function buildChromeArgs(options: LaunchOptions, userAgent?: string): string[] {
  const args = [...CHROME_ARGS];
  // Omitted when no User-Agent was resolved, so the browser speaks for itself
  // rather than being told to claim a version nobody could verify.
  if (userAgent) {
    args.push(`--user-agent=${userAgent}`);
  }
  if (options.headless ?? false) {
    args.push("--headless=new");
  }
  return args;
}

/**
 * A desktop User-Agent for the version of Chrome actually being launched.
 *
 * The version used to be hardcoded at 133, while the installed browser was
 * whatever the user had. That put the `User-Agent` header and the browser's own
 * `Sec-CH-UA` client hints out of step, and two sources disagreeing about the
 * same browser is exactly the kind of contradiction bot detection looks for. The
 * version now comes from the installed Chrome.
 */
export function buildUserAgent(version: string, platform: NodeJS.Platform = os.platform()): string {
  const tokens =
    platform === "darwin"
      ? "(Macintosh; Intel Mac OS X 10_15_7)"
      : platform === "win32"
      ? "(Windows NT 10.0; Win64; x64)"
      : "(X11; Linux x86_64)";
  return `Mozilla/5.0 ${tokens} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

let cachedChromeVersion: string | null | undefined;

/**
 * The `User-Agent` header to send, built from the installed Chrome.
 *
 * Shared with the plain-HTTP capabilities, which each carried their own copy of
 * a hardcoded Chrome 133 string: seven places claiming one version, none of them
 * the version actually installed. Spreading this means one version is claimed
 * everywhere, and nothing is claimed when the browser cannot be identified,
 * rather than asserting a release we cannot check.
 */
export function userAgentHeader(): Record<string, string> {
  const version = detectChromeVersion();
  return version ? { "User-Agent": buildUserAgent(version) } : {};
}

/**
 * The version of the installed Chrome, or null when it cannot be read.
 *
 * Probed once and remembered: this is called on every launch, and spawning the
 * browser to ask its version is not something to repeat per page.
 */
export function detectChromeVersion(): string | null {
  if (cachedChromeVersion !== undefined) return cachedChromeVersion;
  cachedChromeVersion = readChromeVersion();
  return cachedChromeVersion;
}

function readChromeVersion(): string | null {
  const chromePath = findSystemChromePath();
  if (!chromePath) return null;

  // The binary is the source of truth and behaves the same on all three
  // platforms. `--version` prints and exits, so nothing is started.
  try {
    const output = execFileSync(chromePath, ["--version"], { encoding: "utf8" });
    const match = output.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (match?.[1]) return match[1];
  } catch {
    // Fall through to the per-platform lookups below.
  }

  // macOS: the bundle's own version string, which `plutil` reads whether the
  // plist is XML or binary.
  if (os.platform() === "darwin") {
    try {
      const plist = path.resolve(chromePath, "..", "..", "Info.plist");
      const output = execFileSync(
        "plutil",
        ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist],
        { encoding: "utf8" }
      );
      const match = output.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match?.[1]) return match[1];
    } catch {
      // Fall through to the directory scan.
    }
  }

  // Windows lays the version out as a sibling directory of the executable
  // (`Application/153.0.8010.48/`), which is readable without launching it.
  try {
    const sibling = fs
      .readdirSync(path.dirname(chromePath))
      .find((entry) => /^\d+\.\d+\.\d+\.\d+$/.test(entry));
    if (sibling) return sibling;
  } catch {
    // Nothing left to try.
  }

  return null;
}

/**
 * Finds the native system Google Chrome executable path across macOS, Linux, and Windows.
 */
export function findSystemChromePath(): string | null {
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    candidates.push(
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export class BrowserDriver {
  private baseDir: string;
  private activeContexts = new Map<string, BrowserContext>();

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ??
      process.env.HELMSMAN_HOME ??
      path.join(os.homedir(), ".helmsman");
  }

  /**
   * Resolves the disk path for a named persistent profile.
   */
  getProfilePath(profileName: string): string {
    return path.join(this.baseDir, "profiles", profileName);
  }

  /**
   * Lists all existing persistent profile names.
   */
  listProfiles(): string[] {
    const profilesDir = path.join(this.baseDir, "profiles");
    if (!fs.existsSync(profilesDir)) return [];
    return fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Checks if a profile directory has an active or stale Chrome singleton lock.
   */
  getProfileLock(profileName: string): { pid: number; isAlive: boolean } | null {
    const userDataDir = this.getProfilePath(profileName);
    const lockPath = path.join(userDataDir, "SingletonLock");
    try {
      if (!fs.existsSync(lockPath)) {
        try {
          fs.lstatSync(lockPath);
        } catch {
          return null;
        }
      }

      let target: string;
      try {
        target = fs.readlinkSync(lockPath);
      } catch {
        return null;
      }

      const match = target.match(/-(\d+)$/);
      if (!match || !match[1]) return null;

      const pid = Number.parseInt(match[1], 10);
      if (Number.isNaN(pid) || pid <= 0) return null;

      let isAlive = false;
      try {
        process.kill(pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }

      return { pid, isAlive };
    } catch {
      return null;
    }
  }

  /**
   * Cleans stale Chromium singleton locks, sockets, and cookies from a profile directory.
   */
  cleanProfileLocks(profileName: string): void {
    const userDataDir = this.getProfilePath(profileName);
    const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
    for (const file of lockFiles) {
      const fullPath = path.join(userDataDir, file);
      try {
        fs.unlinkSync(fullPath);
      } catch {}
    }
  }

  /**
   * Gracefully terminates any process holding a lock on this profile,
   * waiting for it to exit and cleaning up lock files.
   */
  async terminateProfileProcess(profileName: string, timeoutMs = 3000): Promise<boolean> {
    const lock = this.getProfileLock(profileName);
    if (!lock) {
      this.cleanProfileLocks(profileName);
      return true;
    }

    if (!lock.isAlive) {
      this.cleanProfileLocks(profileName);
      return true;
    }

    try {
      process.kill(lock.pid, "SIGTERM");
    } catch {
      this.cleanProfileLocks(profileName);
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        process.kill(lock.pid, 0);
      } catch {
        this.cleanProfileLocks(profileName);
        return true;
      }
    }

    try {
      process.kill(lock.pid, "SIGKILL");
    } catch {}

    await new Promise((r) => setTimeout(r, 200));
    this.cleanProfileLocks(profileName);
    return true;
  }

  /**
   * Spawns a 100% native Google Chrome instance for manual user authentication.
   * Runs directly via the operating system with NO automation flags, NO CDP pipes,
   * and full native sandboxing - completely eliminating bot detection on Google,
   * Twitter, Reddit, and LinkedIn logins.
   */
  launchNativeChromeForLogin(profileName: string, targetUrl: string): ChildProcess | null {
    const chromePath = findSystemChromePath();
    if (!chromePath) return null;

    const lock = this.getProfileLock(profileName);
    if (lock && !lock.isAlive) {
      this.cleanProfileLocks(profileName);
    }

    const userDataDir = this.getProfilePath(profileName);
    fs.mkdirSync(userDataDir, { recursive: true });

    const args = [
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      targetUrl,
    ];

    const child = spawn(chromePath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return child;
  }

  /**
   * Launches or retrieves a persistent browser context for automated sessions,
   * applying stealth evasions, anti-detection flags, and profile lock resolution.
   */
  async launch(profileName: string, options: LaunchOptions = {}): Promise<BrowserContext> {
    const existing = this.activeContexts.get(profileName);
    if (existing) {
      return existing;
    }

    // Connect via remote CDP if endpoint provided
    if (options.endpoint) {
      const browser = await chromium.connectOverCDP(options.endpoint);
      const contexts = browser.contexts();
      const context = contexts[0] ?? (await browser.newContext());
      await applyStealth(context);
      this.activeContexts.set(profileName, context);
      return context;
    }

    const userDataDir = this.getProfilePath(profileName);
    fs.mkdirSync(userDataDir, { recursive: true });

    // Resolve profile lock conflicts
    const lock = this.getProfileLock(profileName);
    if (lock) {
      if (!lock.isAlive) {
        this.cleanProfileLocks(profileName);
      } else if (options.killExisting !== false) {
        await this.terminateProfileProcess(profileName);
      } else {
        throw new Error(
          `Profile '${profileName}' is currently in use by an active Google Chrome process (PID ${lock.pid}). Close Chrome or pass killExisting: true to proceed.`
        );
      }
    }

    const isHeadless = options.headless ?? false;

    // Built from the installed Chrome, so the User-Agent cannot claim a release
    // the browser is not. If the version cannot be read, no override is applied:
    // letting the browser speak for itself beats asserting a version we do not
    // know, and mismatched metadata is itself a signal.
    const version = detectChromeVersion();
    const defaultUserAgent = version ? buildUserAgent(version) : undefined;
    const userAgent = options.userAgent ?? defaultUserAgent;
    if (!userAgent) {
      console.warn(
        "[helmsman] Could not read the installed Chrome version, so the browser's own User-Agent is left in place."
      );
    }
    const chromeArgs = buildChromeArgs(options, userAgent);

    const launchFn = async () => {
      return await chromium.launchPersistentContext(userDataDir, {
        channel: "chrome", // Uses system-installed Google Chrome
        headless: isHeadless,
        chromiumSandbox: true, // Crucial: enables OS sandboxing to prevent the --no-sandbox warning
        args: chromeArgs,
        userAgent,
        viewport: options.viewport ?? (isHeadless ? { width: 1280, height: 800 } : null),
        ignoreDefaultArgs: [...IGNORED_DEFAULT_ARGS],
      });
    };

    let context: BrowserContext;
    try {
      context = await launchFn();
    } catch (err: any) {
      if (err && String(err.message).includes("Opening in existing browser session")) {
        // Force cleanup and retry once
        await this.terminateProfileProcess(profileName, 2000);
        context = await launchFn();
      } else {
        throw err;
      }
    }

    await applyStealth(context);
    this.activeContexts.set(profileName, context);

    context.on("close", () => {
      this.activeContexts.delete(profileName);
      this.cleanProfileLocks(profileName);
    });

    return context;
  }

  /**
   * Helper to open or obtain an active page within a profile.
   */
  async getPage(profileName: string, options: LaunchOptions = {}): Promise<Page> {
    const context = await this.launch(profileName, options);
    const pages = context.pages();
    return pages[0] ?? (await context.newPage());
  }

  /**
   * Exports the authenticated storage state (cookies + localStorage) to a JSON file.
   */
  async exportStorageState(profileName: string, outputPath: string): Promise<void> {
    const context = await this.launch(profileName, { headless: true });
    await context.storageState({ path: outputPath });
    await this.close(profileName);
  }

  /**
   * Closes a specific profile's context.
   */
  async close(profileName: string): Promise<void> {
    const context = this.activeContexts.get(profileName);
    if (context) {
      await context.close();
      this.activeContexts.delete(profileName);
    }
    this.cleanProfileLocks(profileName);
  }

  /**
   * Closes all active contexts.
   */
  async closeAll(): Promise<void> {
    for (const [name, context] of this.activeContexts) {
      await context.close();
      this.activeContexts.delete(name);
      this.cleanProfileLocks(name);
    }
  }
}
