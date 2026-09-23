import type { Resolver, ResolverContext, ResolvedSelector } from "../types.js";
import type { Selector } from "../../workflow/ast.js";

interface ElementSummary {
  index: number;
  role: string;
  text: string;
  id: string | null;
  testid: string | null;
}

/**
 * Tier 2 Resolver: LLM candidate matching (last resort).
 * Only invoked when DOM broadening and Accessibility token similarity fail.
 * Connects to any OpenAI-compatible completions endpoint with a token-cheap prompt.
 */
export class LlmResolver implements Resolver {
  public readonly tier = "llm" as const;

  async resolve(context: ResolverContext): Promise<ResolvedSelector | null> {
    const apiKey = process.env.HELMSMAN_LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // LLM credentials not set; skip gracefully
      return null;
    }

    const baseUrl = (process.env.HELMSMAN_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.HELMSMAN_LLM_MODEL || "gpt-4o-mini";

    // 1. Gather visible interactive candidates (capped at 50)
    const elements: ElementSummary[] = await context.page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")
      );

      return candidates
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        })
        .slice(0, 50)
        .map((el, index) => {
          const text = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
          return {
            index,
            role: el.getAttribute("role") || el.tagName.toLowerCase(),
            text: text.slice(0, 60),
            id: el.id || null,
            testid: el.getAttribute("data-testid") || el.getAttribute("data-test-id") || null,
          };
        });
    });

    if (elements.length === 0) return null;

    // 2. Build prompt
    const candidateList = elements
      .map((e) => `[${e.index}] role=${e.role}, text="${e.text}"${e.id ? `, id="${e.id}"` : ""}${e.testid ? `, testid="${e.testid}"` : ""}`)
      .join("\n");

    const prompt = `You are a browser self-healing assistant. An action in an automated workflow failed to find its target element.
Step intent: "${context.step.intent || "Unknown intent"}"
Stale failed selectors: ${JSON.stringify(context.staleSelectors)}

Here is the list of currently visible interactive elements on the page:
${candidateList}

Which candidate element index most plausibly accomplishes the step's intent?
Respond ONLY with a JSON object in this exact format:
{"selectedIndex": <number>, "reason": "<short explanation>"}`;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content) as { selectedIndex?: number; reason?: string };
      if (typeof parsed.selectedIndex !== "number" || parsed.selectedIndex < 0 || parsed.selectedIndex >= elements.length) {
        return null;
      }

      const picked = elements[parsed.selectedIndex]!;
      let resolved: Selector;

      if (picked.testid) {
        resolved = { strategy: "testid", value: picked.testid };
      } else if (picked.id) {
        resolved = { strategy: "css", value: `#${CSS.escape(picked.id)}` };
      } else if (picked.role && picked.text) {
        resolved = { strategy: "role", role: picked.role, name: picked.text };
      } else {
        resolved = { strategy: "text", value: picked.text, exact: true };
      }

      return {
        selector: resolved,
        tier: "llm",
        confidence: 0.75,
        explanation: parsed.reason || `LLM selected candidate [${picked.index}]: ${picked.text}`,
      };
    } catch {
      return null;
    }
  }
}
