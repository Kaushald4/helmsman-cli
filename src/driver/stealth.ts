import type { Page, BrowserContext } from "playwright-core";

/**
 * Modern best-in-class stealth script targeting CreepJS, Incolumitas,
 * Cloudflare Turnstile, and DataDome detection vectors.
 */
export const STEALTH_INJECTION_SCRIPT = `
(() => {
  if (window.__helmsman_stealth_applied) return;
  window.__helmsman_stealth_applied = true;

  // -------------------------------------------------------------------------
  // 1. Function.prototype.toString Tampering Defense
  // CreepJS, DataDome, and Cloudflare verify that overridden functions return
  // authentic "[native code]" strings and that toString itself is untampered.
  // -------------------------------------------------------------------------
  const customToStringMap = new Map();

  const registerNative = (fn, name) => {
    if (!fn) return;
    try {
      Object.defineProperty(fn, 'name', { value: name, configurable: true });
      customToStringMap.set(fn, 'function ' + name + '() { [native code] }');
    } catch (e) {}
  };

  try {
    const nativeToString = Function.prototype.toString;
    const wrappedToString = new Proxy(nativeToString, {
      apply(target, thisArg, args) {
        if (customToStringMap.has(thisArg)) {
          return customToStringMap.get(thisArg);
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    Function.prototype.toString = wrappedToString;
    registerNative(Function.prototype.toString, 'toString');
  } catch (e) {}

  // -------------------------------------------------------------------------
  // 2. Prototype-level navigator.webdriver removal
  // In real Chrome, 'webdriver' property lives on Navigator.prototype and is false.
  // Directly defining it on 'navigator' creates an ownProperty leak.
  // -------------------------------------------------------------------------
  try {
    const proto = Object.getPrototypeOf(navigator);
    if ('webdriver' in proto) {
      delete proto.webdriver;
    }
    const getter = function webdriver() {
      return false;
    };
    registerNative(getter, 'get webdriver');
    Object.defineProperty(proto, 'webdriver', {
      get: getter,
      set: undefined,
      enumerable: true,
      configurable: true,
    });
  } catch (e) {}

  // -------------------------------------------------------------------------
  // 3. Comprehensive window.chrome emulation
  // Anti-bot scripts check for csi(), loadTimes(), and app structures.
  // -------------------------------------------------------------------------
  if (!window.chrome) {
    window.chrome = {} as any;
  }

  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run',
    };
  }

  if (!window.chrome.csi) {
    const csiFn = function csi() {
      const now = Date.now();
      return {
        startE: now,
        onloadT: now + 50,
        pageT: 50.5,
        tran: 15,
      };
    };
    registerNative(csiFn, 'csi');
    window.chrome.csi = csiFn;
  }

  if (!window.chrome.loadTimes) {
    const loadTimesFn = function loadTimes() {
      const now = Date.now() / 1000;
      return {
        commitLoadTime: now,
        connectionInfo: 'http/1.1',
        finishDocumentLoadTime: now + 0.05,
        finishLoadTime: now + 0.08,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: now + 0.03,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: now - 0.02,
        startLoadTime: now - 0.02,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
    registerNative(loadTimesFn, 'loadTimes');
    window.chrome.loadTimes = loadTimesFn;
  }

  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      id: undefined,
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      connect: () => ({ disconnect: () => {}, postMessage: () => {}, onDisconnect: { addListener: () => {} }, onMessage: { addListener: () => {} } }),
      sendMessage: (_: any, cb?: any) => { if (cb) cb(); },
    };
  }

  // -------------------------------------------------------------------------
  // 4. Realistic navigator.plugins and mimeTypes
  // -------------------------------------------------------------------------
  if (navigator.plugins.length === 0) {
    const mockPlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => mockPlugins,
        enumerable: true,
        configurable: true,
      });
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // 5. Permissions API query fix
  // Automated Chrome often returns 'denied' for Notification query.
  // -------------------------------------------------------------------------
  if (navigator.permissions && navigator.permissions.query) {
    const origQuery = navigator.permissions.query;
    const queryFn = function query(parameters: any) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({
          state: Notification.permission === 'granted' ? 'granted' : 'prompt',
          onchange: null,
        } as PermissionStatus);
      }
      return origQuery.call(this, parameters);
    };
    registerNative(queryFn, 'query');
    navigator.permissions.query = queryFn;
  }

  // -------------------------------------------------------------------------
  // 6. WebGL Vendor & Renderer unmasking
  // Replaces SwiftShader/llvmpipe with authentic hardware strings if detected.
  // -------------------------------------------------------------------------
  const patchWebGL = (proto: any) => {
    if (!proto || !proto.getParameter) return;
    const origGetParameter = proto.getParameter;
    const getParamFn = function getParameter(param: number) {
      // UNMASKED_VENDOR_WEBGL = 0x9245
      if (param === 37445) {
        return 'Google Inc. (Apple)';
      }
      // UNMASKED_RENDERER_WEBGL = 0x9246
      if (param === 37446) {
        const val = origGetParameter.call(this, param);
        if (!val || /swiftshader|llvmpipe|software/i.test(String(val))) {
          return 'ANGLE (Apple, Apple M2, OpenGL 4.1)';
        }
        return val;
      }
      return origGetParameter.call(this, param);
    };
    registerNative(getParamFn, 'getParameter');
    proto.getParameter = getParamFn;
  };

  try {
    if (typeof WebGLRenderingContext !== 'undefined') {
      patchWebGL(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      patchWebGL(WebGL2RenderingContext.prototype);
    }
  } catch (e) {}

  // -------------------------------------------------------------------------
  // 7. Window Geometry Normalization
  // Headless mode often sets outerWidth/outerHeight to 0.
  // -------------------------------------------------------------------------
  try {
    if (window.outerWidth === 0) {
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth || 1280 });
    }
    if (window.outerHeight === 0) {
      Object.defineProperty(window, 'outerHeight', { get: () => (window.innerHeight || 800) + 85 });
    }
  } catch (e) {}

  // -------------------------------------------------------------------------
  // 8. Headless User-Agent & Client Hints Masking
  // Strips 'HeadlessChrome' so Cloudflare, DataDome, and Reddit don't block headless requests
  // -------------------------------------------------------------------------
  try {
    if (/HeadlessChrome/.test(navigator.userAgent)) {
      const cleanUA = navigator.userAgent.replace(/HeadlessChrome/g, 'Chrome');
      Object.defineProperty(Object.getPrototypeOf(navigator), 'userAgent', {
        get: () => cleanUA,
        configurable: true,
        enumerable: true,
      });
      Object.defineProperty(Object.getPrototypeOf(navigator), 'appVersion', {
        get: () => cleanUA.replace(/^Mozilla\//, ''),
        configurable: true,
        enumerable: true,
      });
    }

    if (navigator.userAgentData && navigator.userAgentData.brands) {
      const cleanBrands = navigator.userAgentData.brands.map((b) => ({
        brand: b.brand.replace(/HeadlessChrome/g, 'Google Chrome'),
        version: b.version,
      }));
      Object.defineProperty(navigator.userAgentData, 'brands', {
        get: () => cleanBrands,
        configurable: true,
        enumerable: true,
      });
    }
  } catch (e) {}
})();
`;

export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_INJECTION_SCRIPT);
}

export async function applyStealthToPage(page: Page): Promise<void> {
  await page.addInitScript(STEALTH_INJECTION_SCRIPT);
}
