import type { Page } from "playwright-core";
import { z } from "zod";
import type { BrowserDriver } from "../driver/browser.js";

export type RiskLevel = "read" | "write" | "destructive";

export interface ExecutionContext {
  page: Page;
  driver: BrowserDriver;
  profileName: string;
  signal?: AbortSignal;
}

export interface Capability<TInput = any, TOutput = any> {
  /** Unique dot-namespaced identifier (e.g. "reddit.feed", "twitter.search") */
  id: string;

  /** Human-readable short name */
  name: string;

  /** Descriptive summary of what this capability does (used for MCP tool description) */
  description: string;

  /** Risk classification to support policy gates and human confirmation */
  riskLevel: RiskLevel;

  /** Zod schema validating incoming parameters */
  inputSchema: z.ZodType<TInput, any, any>;

  /** Main execution function driving the browser or workflow */
  execute(ctx: ExecutionContext, input: TInput): Promise<TOutput>;
}
