import type { Page } from "playwright-core";
import type { Selector, WorkflowStep } from "../workflow/ast.js";

export interface ResolverContext {
  page: Page;
  step: WorkflowStep;
  staleSelectors: Selector[];
  error: Error;
}

export interface ResolvedSelector {
  selector: Selector;
  tier: "dom" | "accessibility" | "llm";
  confidence: number;
  explanation?: string;
}

export interface Resolver {
  readonly tier: "dom" | "accessibility" | "llm";
  resolve(context: ResolverContext): Promise<ResolvedSelector | null>;
}
