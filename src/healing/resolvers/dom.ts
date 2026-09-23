import type { Resolver, ResolverContext, ResolvedSelector } from "../types.js";

/**
 * Tier 0 Resolver: Pure CSS path broadening.
 * Zero AI, zero page re-scan. Progressively drops outermost segments of a > joined CSS path
 * to repair over-specific selectors broken by container/wrapper element shifts.
 */
export class DomResolver implements Resolver {
  public readonly tier = "dom" as const;

  async resolve(context: ResolverContext): Promise<ResolvedSelector | null> {
    const cssCandidates = context.staleSelectors.filter((s) => s.strategy === "css");
    if (cssCandidates.length === 0) return null;

    for (const cand of cssCandidates) {
      if (cand.strategy !== "css") continue;
      const originalPath = cand.value;
      const segments = originalPath.split(/\s*>\s*/);
      if (segments.length <= 1) continue;

      // Try progressively dropping outer segments (e.g. A > B > C -> B > C -> C)
      for (let i = 1; i < segments.length; i++) {
        const broadened = segments.slice(i).join(" > ");
        try {
          const locator = context.page.locator(broadened);
          const count = await locator.count();
          // We require at least 1 match, and ideally a single unique match
          if (count === 1) {
            const isVisible = await locator.first().isVisible().catch(() => false);
            if (isVisible) {
              return {
                selector: { strategy: "css", value: broadened },
                tier: "dom",
                confidence: 0.6,
                explanation: `Broadened CSS path from '${originalPath}' to '${broadened}'`,
              };
            }
          }
        } catch {
          // Syntax or locator error, continue to next
        }
      }
    }

    return null;
  }
}
