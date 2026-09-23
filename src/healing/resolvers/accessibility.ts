import type { Resolver, ResolverContext, ResolvedSelector } from "../types.js";
import type { Selector } from "../../workflow/ast.js";

interface InteractiveElementInfo {
  role: string | null;
  name: string;
  id: string | null;
  testid: string | null;
  tagName: string;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Tier 1 Resolver: Accessibility tree & ARIA token similarity.
 * Re-scans currently visible interactive elements and matches by semantic text overlap.
 * Zero AI required. Solves renamed IDs/classes where visible intent text is unchanged.
 */
export class AccessibilityResolver implements Resolver {
  public readonly tier = "accessibility" as const;
  private minScore = 0.5;

  async resolve(context: ResolverContext): Promise<ResolvedSelector | null> {
    // 1. Determine target text from original selectors or step intent
    let targetText = "";
    for (const s of context.staleSelectors) {
      if (s.strategy === "role" && s.name) {
        targetText = s.name;
        break;
      }
      if (s.strategy === "text" && s.value) {
        targetText = s.value;
        break;
      }
      if (s.strategy === "label" && s.value) {
        targetText = s.value;
        break;
      }
    }

    if (!targetText && context.step.intent) {
      // Extract quoted portion of intent or full intent
      const quoteMatch = context.step.intent.match(/["']([^"']+)["']/);
      targetText = quoteMatch && quoteMatch[1] ? quoteMatch[1] : context.step.intent;
    }

    if (!targetText) return null;
    const targetTokens = tokenize(targetText);
    if (targetTokens.size === 0) return null;

    // 2. Scan currently visible interactive elements
    const elements: InteractiveElementInfo[] = await context.page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          "button, a[href], input, select, textarea, [role='button'], [role='link']"
        )
      );

      return candidates
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none"
          );
        })
        .map((el) => {
          const role = el.getAttribute("role") || (el.tagName.toLowerCase() === "button" ? "button" : null);
          const name =
            el.getAttribute("aria-label") ||
            (el instanceof HTMLInputElement ? el.value : "") ||
            el.textContent ||
            "";
          const id = el.id || null;
          const testid =
            el.getAttribute("data-testid") || el.getAttribute("data-test-id") || null;

          return {
            role,
            name: name.trim().replace(/\s+/g, " "),
            id,
            testid,
            tagName: el.tagName.toLowerCase(),
          };
        });
    });

    // 3. Score elements by token similarity
    let bestMatch: InteractiveElementInfo | null = null;
    let bestScore = 0;

    for (const el of elements) {
      if (!el.name) continue;
      const candTokens = tokenize(el.name);
      const score = jaccardSimilarity(targetTokens, candTokens);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }

    if (bestMatch && bestScore >= this.minScore) {
      let resolvedSelector: Selector;

      if (bestMatch.role && bestMatch.name) {
        resolvedSelector = { strategy: "role", role: bestMatch.role, name: bestMatch.name };
      } else if (bestMatch.testid) {
        resolvedSelector = { strategy: "testid", value: bestMatch.testid };
      } else if (bestMatch.id) {
        resolvedSelector = { strategy: "css", value: `#${CSS.escape(bestMatch.id)}` };
      } else {
        resolvedSelector = { strategy: "text", value: bestMatch.name, exact: true };
      }

      return {
        selector: resolvedSelector,
        tier: "accessibility",
        confidence: Math.min(0.9, bestScore + 0.2),
        explanation: `Matched visible element '${bestMatch.name}' with similarity score ${(bestScore * 100).toFixed(0)}%`,
      };
    }

    return null;
  }
}
