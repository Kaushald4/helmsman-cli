import type { RawInteractionEvent } from "./recorder.js";
import {
  workflowAstSchema,
  type WorkflowAst,
  type WorkflowStep,
  type WorkflowInput,
} from "./ast.js";

const DESTRUCTIVE_KEYWORDS = /\b(delete|remove|cancel|destroy|terminate|drop|purge|buy|purchase|pay|unsubscribe|reset)\b/i;

export interface CompileOptions {
  id: string;
  name?: string;
  description?: string;
  domain?: string;
  parameterizeFills?: boolean; // If true, turns filled text values into {{input.fieldName}}
}

/**
 * Normalizes events: removes duplicate same-URL navigations and blanks.
 */
export function normalizeEvents(events: RawInteractionEvent[]): RawInteractionEvent[] {
  const result: RawInteractionEvent[] = [];
  for (const ev of events) {
    if (ev.kind === "navigate" && (ev.url === "about:blank" || ev.url === "")) continue;

    const prev = result[result.length - 1];
    if (prev && prev.kind === "navigate" && ev.kind === "navigate" && prev.url === ev.url) {
      continue; // Dedupe same navigation
    }
    result.push(ev);
  }
  return result;
}

/**
 * Optimizes interactions:
 * - Drops redundant click on an input element right before filling it.
 * - Collapses multiple consecutive fills on the same field into the final value.
 */
export function optimizeEvents(events: RawInteractionEvent[]): RawInteractionEvent[] {
  const result: RawInteractionEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const current = events[i]!;
    const next = events[i + 1];

    // If click on input immediately followed by fill on same element, skip click
    if (
      current.kind === "click" &&
      next &&
      next.kind === "fill" &&
      current.selectors &&
      next.selectors &&
      JSON.stringify(current.selectors[0]) === JSON.stringify(next.selectors[0])
    ) {
      continue;
    }

    // If consecutive fills on same selector, take the latest
    if (
      current.kind === "fill" &&
      next &&
      next.kind === "fill" &&
      current.selectors &&
      next.selectors &&
      JSON.stringify(current.selectors[0]) === JSON.stringify(next.selectors[0])
    ) {
      continue;
    }

    // If consecutive scrolls, merge deltas
    if (
      current.kind === "scroll" &&
      next &&
      next.kind === "scroll" &&
      JSON.stringify(current.selectors) === JSON.stringify(next.selectors)
    ) {
      next.scrollDeltaX = (next.scrollDeltaX ?? 0) + (current.scrollDeltaX ?? 0);
      next.scrollDeltaY = (next.scrollDeltaY ?? 0) + (current.scrollDeltaY ?? 0);
      continue;
    }

    // If hover is immediately followed by click on the same element, click subsumes hover
    if (
      current.kind === "hover" &&
      next &&
      next.kind === "click" &&
      current.selectors &&
      next.selectors &&
      JSON.stringify(current.selectors[0]) === JSON.stringify(next.selectors[0])
    ) {
      continue;
    }

    // If consecutive hovers on the same element, keep the latest
    if (
      current.kind === "hover" &&
      next &&
      next.kind === "hover" &&
      current.selectors &&
      next.selectors &&
      JSON.stringify(current.selectors[0]) === JSON.stringify(next.selectors[0])
    ) {
      continue;
    }

    result.push(current);
  }

  return result;
}

/**
 * Compiles a raw recorded trace into a validated, versioned WorkflowAst.
 */
export function compileWorkflow(
  rawEvents: RawInteractionEvent[],
  options: CompileOptions
): WorkflowAst {
  const normalized = normalizeEvents(rawEvents);
  const optimized = optimizeEvents(normalized);

  const steps: WorkflowStep[] = [];
  const inputs: WorkflowInput[] = [];
  const domain =
    options.domain ||
    (optimized.find((e) => e.url && e.url.startsWith("http"))
      ? new URL(optimized.find((e) => e.url && e.url.startsWith("http"))!.url).hostname
      : "example.com");

  let stepCounter = 1;
  let hasWrite = false;
  let hasDestructive = false;

  for (const ev of optimized) {
    const stepId = `step-${stepCounter++}`;

    if (ev.kind === "navigate") {
      if (DESTRUCTIVE_KEYWORDS.test(ev.url)) hasDestructive = true;
      steps.push({
        id: stepId,
        type: "goto",
        url: ev.url,
        intent: `Navigate to ${ev.url}`,
      });
    } else if (ev.kind === "hover") {
      if (!ev.selectors || ev.selectors.length === 0) continue;
      const intentName = ev.accessibleName ? `"${ev.accessibleName}"` : ev.elementTag || "element";
      steps.push({
        id: stepId,
        type: "hover",
        selectors: ev.selectors,
        intent: `Hover over ${intentName}`,
      });
    } else if (ev.kind === "click") {
      if (!ev.selectors || ev.selectors.length === 0) continue;
      const intentName = ev.accessibleName ? `"${ev.accessibleName}"` : ev.elementTag || "element";
      const intent = `Click ${intentName}`;

      if (DESTRUCTIVE_KEYWORDS.test(intentName)) hasDestructive = true;

      steps.push({
        id: stepId,
        type: "click",
        selectors: ev.selectors,
        intent,
      });
    } else if (ev.kind === "scroll") {
      const deltaY = ev.scrollDeltaY ?? 500;
      const deltaX = ev.scrollDeltaX ?? 0;
      // Skip negligible scrolls
      if (Math.abs(deltaY) < 30 && Math.abs(deltaX) < 30) continue;

      const direction = deltaY >= 0 ? "down" : "up";
      const targetDesc = ev.elementTag && ev.elementTag !== "window" ? ` in <${ev.elementTag}>` : "";
      const intent = `Scroll ${direction} ${Math.abs(deltaY)}px${targetDesc}`;

      steps.push({
        id: stepId,
        type: "scroll",
        deltaX,
        deltaY,
        selectors: ev.selectors && ev.selectors.length > 0 ? ev.selectors : undefined,
        intent,
      });
    } else if (ev.kind === "fill") {
      if (!ev.selectors || ev.selectors.length === 0) continue;
      hasWrite = true;

      const fieldName = (ev.accessibleName || `field_${stepCounter}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "");

      let val = ev.value ?? "";
      if (options.parameterizeFills && fieldName) {
        inputs.push({
          name: fieldName,
          type: "string",
          description: `Value for ${ev.accessibleName || fieldName}`,
          default: val,
          required: true,
        });
        val = `{{${fieldName}}}`;
      }

      steps.push({
        id: stepId,
        type: "fill",
        selectors: ev.selectors,
        value: val,
        intent: `Fill ${ev.accessibleName || "field"} with "${val}"`,
      });
    }
  }

  // Ensure at least one step exists
  if (steps.length === 0) {
    steps.push({
      id: "step-1",
      type: "goto",
      url: `https://${domain}`,
      intent: `Navigate to ${domain}`,
    });
  }

  const riskLevel = hasDestructive ? "destructive" : hasWrite ? "write" : "read";

  const ast: WorkflowAst = {
    id: options.id,
    name: options.name || options.id,
    description: options.description || `Recorded workflow on ${domain}`,
    domain,
    version: 1,
    riskLevel,
    inputs,
    steps,
  };

  return workflowAstSchema.parse(ast);
}
