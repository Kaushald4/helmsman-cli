import type { Page, Locator } from "playwright-core";
import type { Selector } from "./ast.js";

/**
 * Maps a Selector strategy into a Playwright Locator.
 */
export function buildLocator(scope: Page | Locator, selector: Selector): Locator {
  switch (selector.strategy) {
    case "role":
      return scope.getByRole(selector.role as any, { name: selector.name });
    case "testid":
      return scope.getByTestId(selector.value);
    case "text":
      return scope.getByText(selector.value, { exact: selector.exact });
    case "label":
      return scope.getByLabel(selector.value);
    case "css":
      return scope.locator(selector.value);
    case "xpath":
      return scope.locator(`xpath=${selector.value}`);
    default:
      throw new Error(`Unsupported selector strategy: ${(selector as any).strategy}`);
  }
}

export interface WorkingSelectorMatch {
  locator: Locator;
  selector: Selector;
  candidateIndex: number;
}

/**
 * Tries selector candidates in priority order, returning the first one that resolves
 * to an element on the page within the given timeout.
 */
export async function resolveFirstWorkingSelector(
  scope: Page | Locator,
  candidates: Selector[],
  timeoutMs = 2500
): Promise<WorkingSelectorMatch> {
  if (!candidates || candidates.length === 0) {
    throw new Error("No selector candidates provided to resolve.");
  }

  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    try {
      const locator = buildLocator(scope, candidate);
      // Wait for at least one matching element to be attached / visible
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
      return { locator, selector: candidate, candidateIndex: i };
    } catch (err) {
      errors.push(`[${candidate.strategy}] ${JSON.stringify(candidate)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `All ${candidates.length} selector candidates failed to resolve:\n${errors.join("\n")}`
  );
}
