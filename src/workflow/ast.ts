import { z } from "zod";
import type { RiskLevel } from "../capabilities/types.js";

// ---------------------------------------------------------------------------
// SELECTOR STRATEGIES
// ---------------------------------------------------------------------------
export const roleSelectorSchema = z.object({
  strategy: z.literal("role"),
  role: z.string(),
  name: z.string().optional(),
});

export const testidSelectorSchema = z.object({
  strategy: z.literal("testid"),
  value: z.string(),
});

export const textSelectorSchema = z.object({
  strategy: z.literal("text"),
  value: z.string(),
  exact: z.boolean().optional(),
});

export const labelSelectorSchema = z.object({
  strategy: z.literal("label"),
  value: z.string(),
});

export const cssSelectorSchema = z.object({
  strategy: z.literal("css"),
  value: z.string(),
});

export const xpathSelectorSchema = z.object({
  strategy: z.literal("xpath"),
  value: z.string(),
});

export const selectorSchema = z.discriminatedUnion("strategy", [
  roleSelectorSchema,
  testidSelectorSchema,
  textSelectorSchema,
  labelSelectorSchema,
  cssSelectorSchema,
  xpathSelectorSchema,
]);

export type Selector = z.infer<typeof selectorSchema>;

// ---------------------------------------------------------------------------
// WORKFLOW STEPS
// ---------------------------------------------------------------------------
export const gotoStepSchema = z.object({
  id: z.string(),
  type: z.literal("goto"),
  url: z.string(),
  intent: z.string().optional(),
});

export const clickStepSchema = z.object({
  id: z.string(),
  type: z.literal("click"),
  selectors: z.array(selectorSchema).min(1),
  intent: z.string().optional(),
});

export const fillStepSchema = z.object({
  id: z.string(),
  type: z.literal("fill"),
  selectors: z.array(selectorSchema).min(1),
  value: z.string(),
  intent: z.string().optional(),
});

export const scrollStepSchema = z.object({
  id: z.string(),
  type: z.literal("scroll"),
  deltaX: z.number().default(0),
  deltaY: z.number().default(500),
  selectors: z.array(selectorSchema).optional(),
  intent: z.string().optional(),
});

export const waitStepSchema = z.object({
  id: z.string(),
  type: z.literal("wait"),
  selectors: z.array(selectorSchema).optional(),
  timeoutMs: z.number().int().positive().optional(),
  intent: z.string().optional(),
});

export const extractStepSchema = z.object({
  id: z.string(),
  type: z.literal("extract"),
  selectors: z.array(selectorSchema).min(1),
  variableName: z.string(),
  attribute: z.string().optional(), // undefined = innerText
  intent: z.string().optional(),
});

export const extractRecordsStepSchema = z.object({
  id: z.string(),
  type: z.literal("extractRecords"),
  containerSelector: selectorSchema.optional(),
  itemSelector: selectorSchema,
  fields: z.record(
    z.string(),
    z.object({
      selectors: z.array(selectorSchema).min(1),
      attribute: z.string().optional(),
    })
  ),
  variableName: z.string(),
  limit: z.number().int().positive().optional(),
  intent: z.string().optional(),
});

export const hoverStepSchema = z.object({
  id: z.string(),
  type: z.literal("hover"),
  selectors: z.array(selectorSchema).min(1),
  intent: z.string().optional(),
});

export const workflowStepSchema = z.discriminatedUnion("type", [
  gotoStepSchema,
  clickStepSchema,
  hoverStepSchema,
  fillStepSchema,
  scrollStepSchema,
  waitStepSchema,
  extractStepSchema,
  extractRecordsStepSchema,
]);

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

// ---------------------------------------------------------------------------
// WORKFLOW INPUTS & METADATA
// ---------------------------------------------------------------------------
export const workflowInputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]).default("string"),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().default(true),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const healingHistoryEntrySchema = z.object({
  timestamp: z.string(),
  stepId: z.string(),
  oldSelector: selectorSchema,
  newSelector: selectorSchema,
  tier: z.string(),
  confidence: z.number(),
});

export type HealingHistoryEntry = z.infer<typeof healingHistoryEntrySchema>;

export const workflowAstSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  domain: z.string(),
  version: z.number().int().nonnegative().default(1),
  riskLevel: z.enum(["read", "write", "destructive"]).default("read"),
  inputs: z.array(workflowInputSchema).default([]),
  steps: z.array(workflowStepSchema).min(1),
  healingHistory: z.array(healingHistoryEntrySchema).optional(),
});

export type WorkflowAst = z.infer<typeof workflowAstSchema>;
