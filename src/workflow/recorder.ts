import type { Page } from "playwright-core";
import type { Selector } from "./ast.js";

export interface RawInteractionEvent {
  kind: "navigate" | "click" | "fill" | "scroll" | "hover";
  url: string;
  timestamp: string;
  selectors?: Selector[];
  value?: string;
  elementTag?: string;
  accessibleName?: string;
  scrollDeltaX?: number;
  scrollDeltaY?: number;
  scrollX?: number;
  scrollY?: number;
}

/**
 * Script injected into the recording page to capture user clicks and inputs
 * and calculate prioritized selector candidates on the fly.
 */
export const RECORDER_INJECTION_SCRIPT = `
(() => {
  if (window.__helmsman_recorder_installed) return;
  window.__helmsman_recorder_installed = true;

  function getTestId(el) {
    return el.getAttribute('data-testid') ||
           el.getAttribute('data-test-id') ||
           el.getAttribute('data-qa') ||
           el.getAttribute('data-cy') ||
           null;
  }

  function getAccessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    // Check alt for image / icon elements
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();

    // Check svg title if present inside
    const svgTitle = el.querySelector('svg > title');
    if (svgTitle && svgTitle.textContent && svgTitle.textContent.trim()) {
      return svgTitle.textContent.trim();
    }

    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length <= 80) return text;
    return null;
  }

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;

    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'summary') return 'button';

    // Elements with aria-haspopup or aria-expanded behave as buttons/comboboxes
    if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded')) {
      return el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : 'button';
    }

    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return null;
  }

  function getLabel(el) {
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && label.textContent) return label.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();
    return null;
  }

  function findClickableElement(target) {
    if (!target || !(target instanceof Element)) return null;

    // 1. Explicit semantic interactive elements or ARIA widgets
    const semantic = target.closest(
      'a, button, input, select, textarea, summary, ' +
      '[role="button"], [role="link"], [role="menuitem"], [role="combobox"], [role="tab"], [role="option"], ' +
      '[aria-haspopup], [aria-expanded], [data-state], [data-toggle], [data-dropdown], [data-action]'
    );
    if (semantic) return semantic;

    // 2. Ascend to find cursor:pointer or interactive tabindex
    let cur = target;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.hasAttribute('tabindex') && cur.getAttribute('tabindex') !== '-1') {
        return cur;
      }
      if (cur.hasAttribute('onclick')) {
        return cur;
      }
      try {
        const style = window.getComputedStyle(cur);
        if (style && style.cursor === 'pointer') {
          // Find outermost container that represents the button/menu item
          let container = cur;
          while (
            container.parentElement &&
            container.parentElement !== document.body &&
            container.parentElement !== document.documentElement &&
            window.getComputedStyle(container.parentElement).cursor === 'pointer' &&
            !container.parentElement.matches('nav, header, main, section, ul, ol, body, div.container')
          ) {
            container = container.parentElement;
          }
          return container;
        }
      } catch (e) {}
      cur = cur.parentElement;
    }

    return target;
  }

  function getCssSelector(el) {
    if (el.id && !/radix|headlessui|:[a-z0-9]/.test(el.id)) {
      return '#' + CSS.escape(el.id);
    }
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 4) {
      const testid = getTestId(cur);
      if (testid) {
        parts.unshift('[data-testid="' + CSS.escape(testid) + '"]');
        break;
      }
      let part = cur.tagName.toLowerCase();
      // Add meaningful class if present
      if (cur.classList && cur.classList.length > 0) {
        const meaningfulClass = Array.from(cur.classList).find(
          c => /btn|button|menu|item|nav|toggle|dropdown|link|tab|trigger/i.test(c) && !/active|focus|hover/i.test(c)
        );
        if (meaningfulClass) {
          part += '.' + CSS.escape(meaningfulClass);
        }
      }

      if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function computeSelectorCandidates(el) {
    const candidates = [];
    const role = getRole(el);
    const name = getAccessibleName(el);
    const testid = getTestId(el);
    const label = getLabel(el);
    const aria = el.getAttribute('aria-label');
    const title = el.getAttribute('title');
    const css = getCssSelector(el);

    // 1. Role + Name
    if (role && name) {
      candidates.push({ strategy: 'role', role, name });
    }

    // 2. Test ID
    if (testid) {
      candidates.push({ strategy: 'testid', value: testid });
    }

    // 3. Aria Label / Title CSS attributes (essential for navbar toggles & icons)
    if (aria) {
      candidates.push({ strategy: 'css', value: '[aria-label="' + CSS.escape(aria) + '"]' });
    }
    if (title) {
      candidates.push({ strategy: 'css', value: '[title="' + CSS.escape(title) + '"]' });
    }

    // 4. Label
    if (label) {
      candidates.push({ strategy: 'label', value: label });
    }

    // 5. Clean text (crucial for dropdowns with chevrons/icons!)
    if (name && name.length <= 80) {
      const isLeaf = el.children.length === 0;
      candidates.push({ strategy: 'text', value: name, exact: isLeaf });
    }

    // 6. Anchor href
    if (el.tagName && el.tagName.toLowerCase() === 'a') {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('javascript:')) {
        candidates.push({ strategy: 'css', value: 'a[href="' + CSS.escape(href) + '"]' });
      }
    }

    // 7. CSS path fallback
    if (css) {
      candidates.push({ strategy: 'css', value: css });
    }

    return candidates;
  }

  // Click & Pointerdown listener with deduplication
  let lastRecordedClickTime = 0;
  let lastRecordedTarget = null;

  function recordClickEvent(e) {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;

    // Skip clicks within any potential Helmsman extension UI
    if (target.closest('[data-helmsman-ignore]')) return;

    const interactive = findClickableElement(target) || target;
    const now = Date.now();

    // Deduplicate if pointerdown and click fire rapidly on the same element
    if (lastRecordedTarget === interactive && (now - lastRecordedClickTime) < 350) {
      return;
    }
    lastRecordedTarget = interactive;
    lastRecordedClickTime = now;

    const selectors = computeSelectorCandidates(interactive);
    if (!selectors || selectors.length === 0) return;

    if (window.__helmsman_record_event) {
      window.__helmsman_record_event({
        kind: 'click',
        url: window.location.href,
        timestamp: new Date().toISOString(),
        selectors,
        elementTag: interactive.tagName.toLowerCase(),
        accessibleName: getAccessibleName(interactive) || undefined,
      });
    }
  }

  document.addEventListener('click', recordClickEvent, true);

  // Capture pointerdown for dropdown toggles that open on mousedown/pointerdown
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // Left click only
    if (!e.target || !(e.target instanceof Element)) return;

    const isDropdownTrigger = Boolean(
      e.target.closest('[aria-haspopup], [aria-expanded], [data-state], [data-toggle], [role="combobox"], [role="menuitem"]')
    );
    if (isDropdownTrigger) {
      recordClickEvent(e);
    }
  }, true);

  // Hover tracking for dropdown menus that open on mouseover
  let hoverTimer = null;
  let lastHoveredElement = null;

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;
    if (target.closest('[data-helmsman-ignore]')) return;

    const hoverable = target.closest(
      '[aria-haspopup], [aria-expanded], [data-dropdown], [data-toggle="dropdown"], ' +
      'nav li, nav [role="menuitem"], .dropdown-toggle, [class*="dropdown"], [class*="menu-item"]'
    );

    if (hoverable && hoverable !== lastHoveredElement) {
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        lastHoveredElement = hoverable;
        const selectors = computeSelectorCandidates(hoverable);
        if (selectors && selectors.length > 0 && window.__helmsman_record_event) {
          window.__helmsman_record_event({
            kind: 'hover',
            url: window.location.href,
            timestamp: new Date().toISOString(),
            selectors,
            elementTag: hoverable.tagName.toLowerCase(),
            accessibleName: getAccessibleName(hoverable) || undefined,
          });
        }
      }, 400);
    }
  }, true);

  // Input / change listener
  document.addEventListener('change', (e) => {
    const target = e.target;
    if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;

    const selectors = computeSelectorCandidates(target);
    const value = target.value;

    if (window.__helmsman_record_event) {
      window.__helmsman_record_event({
        kind: 'fill',
        url: window.location.href,
        timestamp: new Date().toISOString(),
        selectors,
        value,
        elementTag: target.tagName.toLowerCase(),
        accessibleName: getLabel(target) || getAccessibleName(target) || undefined,
      });
    }
  }, true);

  // Scroll listener with debouncing and thresholding
  let scrollTimer = null;
  let accumDeltaX = 0;
  let accumDeltaY = 0;
  let lastScrollTarget = null;
  let lastScrollX = window.scrollX;
  let lastScrollY = window.scrollY;

  document.addEventListener('scroll', (e) => {
    const target = e.target;
    const isDoc = (target === document || target === window);
    const curX = isDoc ? window.scrollX : (target.scrollLeft || 0);
    const curY = isDoc ? window.scrollY : (target.scrollTop || 0);

    if (lastScrollTarget !== target) {
      accumDeltaX = 0;
      accumDeltaY = 0;
      lastScrollTarget = target;
      lastScrollX = curX;
      lastScrollY = curY;
    }

    accumDeltaX += (curX - lastScrollX);
    accumDeltaY += (curY - lastScrollY);
    lastScrollX = curX;
    lastScrollY = curY;

    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (Math.abs(accumDeltaY) >= 40 || Math.abs(accumDeltaX) >= 40) {
        const selectors = isDoc ? undefined : computeSelectorCandidates(target);
        if (window.__helmsman_record_event) {
          window.__helmsman_record_event({
            kind: 'scroll',
            url: window.location.href,
            timestamp: new Date().toISOString(),
            scrollDeltaX: Math.round(accumDeltaX),
            scrollDeltaY: Math.round(accumDeltaY),
            scrollX: Math.round(curX),
            scrollY: Math.round(curY),
            selectors,
            elementTag: isDoc ? 'window' : (target.tagName ? target.tagName.toLowerCase() : 'element'),
          });
        }
      }
      accumDeltaX = 0;
      accumDeltaY = 0;
    }, 250);
  }, true);
})();
`;

export class WorkflowRecorder {
  private events: RawInteractionEvent[] = [];
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async start(): Promise<void> {
    this.events = [];

    // Expose binding so browser script can send events to Node in real time
    await this.page.exposeBinding("__helmsman_record_event", (_, event: RawInteractionEvent) => {
      this.events.push(event);
    }).catch(() => {
      // Binding might already be registered
    });

    // Inject capture script on page and all future navigations
    await this.page.addInitScript(RECORDER_INJECTION_SCRIPT);
    await this.page.evaluate(RECORDER_INJECTION_SCRIPT).catch(() => {});

    // Record initial navigation
    this.events.push({
      kind: "navigate",
      url: this.page.url(),
      timestamp: new Date().toISOString(),
    });

    // Listen for navigation events
    this.page.on("framenavigated", (frame) => {
      if (frame === this.page.mainFrame()) {
        this.events.push({
          kind: "navigate",
          url: frame.url(),
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  stop(): RawInteractionEvent[] {
    return [...this.events];
  }
}
