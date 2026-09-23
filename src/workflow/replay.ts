import { z } from "zod";
import type { Page, Locator } from "playwright-core";
import type { WorkflowAst, WorkflowStep } from "./ast.js";
import { buildLocator, resolveFirstWorkingSelector } from "./selectors.js";
import type { Capability, ExecutionContext } from "../capabilities/types.js";

export interface WorkflowExecutionResult {
  workflowId: string;
  status: "success" | "failed";
  variables: Record<string, any>;
  stepResults: Array<{
    stepId: string;
    type: string;
    durationMs: number;
    resolvedSelector?: any;
    error?: string;
  }>;
  totalDurationMs: number;
}

/**
 * Replaces placeholders like {{key}} or ${key} with actual input values.
 */
export function interpolate(template: string, values: Record<string, any>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}|\$\{([a-zA-Z0-9_.-]+)\}/g, (_, g1, g2) => {
    const rawKey = g1 || g2;
    const cleanKey = rawKey.replace(/^input\./, "");
    return values[cleanKey] !== undefined ? String(values[cleanKey]) : `{{${rawKey}}}`;
  });
}

export interface ReplayOptions {
  speed?: "human" | "fast" | "instant";
  interStepDelayMs?: number;
}

export class ReplayExecutor {
  async run(
    ast: WorkflowAst,
    page: Page,
    inputs: Record<string, any> = {},
    options: ReplayOptions = {}
  ): Promise<WorkflowExecutionResult> {
    const { jitteredWait } = await import("../driver/actions.js");
    const speed = options.speed ?? "human";
    const startTime = Date.now();
    const variables: Record<string, any> = { ...inputs };
    const stepResults: WorkflowExecutionResult["stepResults"] = [];

    for (let i = 0; i < ast.steps.length; i++) {
      const step = ast.steps[i]!;

      // Realistic inter-step delay to avoid machine-like rapid firing
      if (i > 0) {
        if (options.interStepDelayMs !== undefined) {
          await new Promise((r) => setTimeout(r, options.interStepDelayMs));
        } else if (speed === "human") {
          await jitteredWait(450, 400); // 450ms - 850ms natural cognitive pause
        } else if (speed === "fast") {
          await jitteredWait(80, 80);
        }
      }

      const stepStart = Date.now();
      try {
        const resolved = await this.dispatchStep(step, page, variables, speed);
        stepResults.push({
          stepId: step.id,
          type: step.type,
          durationMs: Date.now() - stepStart,
          resolvedSelector: resolved,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stepResults.push({
          stepId: step.id,
          type: step.type,
          durationMs: Date.now() - stepStart,
          error: errorMessage,
        });
        return {
          workflowId: ast.id,
          status: "failed",
          variables,
          stepResults,
          totalDurationMs: Date.now() - startTime,
        };
      }
    }

    return {
      workflowId: ast.id,
      status: "success",
      variables,
      stepResults,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Dispatches a single step. Also used by RepairExecutor for retrying steps with patched selectors.
   */
  async dispatchStep(
    step: WorkflowStep,
    page: Page,
    variables: Record<string, any>,
    speed: "human" | "fast" | "instant" = "human"
  ): Promise<any> {
    const { jitteredWait } = await import("../driver/actions.js");

    switch (step.type) {
      case "goto": {
        const targetUrl = interpolate(step.url, variables);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        if (speed === "human") {
          // Pause briefly upon landing as a human would to view page content
          await jitteredWait(600, 400);
        }
        return { url: targetUrl };
      }

      case "hover": {
        const match = await resolveFirstWorkingSelector(page, step.selectors);
        const loc = match.locator.first();
        await loc.scrollIntoViewIfNeeded().catch(() => {});

        if (speed === "human") {
          const box = await loc.boundingBox().catch(() => null);
          if (box) {
            const targetX = box.x + box.width * (0.35 + Math.random() * 0.3);
            const targetY = box.y + box.height * (0.35 + Math.random() * 0.3);
            await page.mouse.move(targetX, targetY, { steps: 8 });
            await jitteredWait(50, 70);
          }
        }
        await loc.hover();
        if (speed === "human") {
          await jitteredWait(250, 200);
        }
        return match.selector;
      }

      case "click": {
        const match = await resolveFirstWorkingSelector(page, step.selectors);
        const loc = match.locator.first();
        await loc.scrollIntoViewIfNeeded().catch(() => {});

        if (speed === "human") {
          const box = await loc.boundingBox().catch(() => null);
          if (box) {
            // Human mouse movement with slight natural landing variance
            const targetX = box.x + box.width * (0.35 + Math.random() * 0.3);
            const targetY = box.y + box.height * (0.35 + Math.random() * 0.3);
            await page.mouse.move(targetX, targetY, { steps: 10 });
            await jitteredWait(60, 90);
          }
          // Click with human-like mousedown dwell time
          await loc.click({ delay: Math.round(50 + Math.random() * 60) });
          await jitteredWait(150, 150);
        } else {
          await loc.click();
        }
        return match.selector;
      }

      case "fill": {
        const match = await resolveFirstWorkingSelector(page, step.selectors);
        const loc = match.locator.first();
        const resolvedValue = interpolate(step.value, variables);
        await loc.scrollIntoViewIfNeeded().catch(() => {});

        if (speed === "human") {
          const box = await loc.boundingBox().catch(() => null);
          if (box) {
            const targetX = box.x + box.width * (0.35 + Math.random() * 0.3);
            const targetY = box.y + box.height * (0.35 + Math.random() * 0.3);
            await page.mouse.move(targetX, targetY, { steps: 8 });
            await jitteredWait(50, 70);
          }
          await loc.click();
          await jitteredWait(80, 100);

          // Clear existing text cleanly before typing
          await loc.fill("");

          // Human character-by-character typing with natural jitter
          const { humanType } = await import("../driver/actions.js");
          await humanType(page, loc, resolvedValue);
          await jitteredWait(150, 150);
        } else {
          await loc.fill(resolvedValue);
        }
        return match.selector;
      }

      case "scroll": {
        if (step.selectors && step.selectors.length > 0) {
          const match = await resolveFirstWorkingSelector(page, step.selectors);
          await match.locator.first().scrollIntoViewIfNeeded();
          if (speed === "human") await jitteredWait(200, 200);
          return match.selector;
        }
        const deltaY = step.deltaY ?? 500;
        const deltaX = step.deltaX ?? 0;
        const { humanScroll } = await import("../driver/actions.js");

        if (speed === "human") {
          if (deltaY !== 0) {
            await humanScroll(page, deltaY, 6);
          }
          if (deltaX !== 0) {
            await page.mouse.wheel(deltaX, 0);
          }
          await jitteredWait(300, 300);
        } else {
          if (deltaY !== 0) await page.mouse.wheel(0, deltaY);
          if (deltaX !== 0) await page.mouse.wheel(deltaX, 0);
        }
        return { deltaX, deltaY };
      }

      case "wait": {
        if (step.selectors && step.selectors.length > 0) {
          const match = await resolveFirstWorkingSelector(page, step.selectors, step.timeoutMs);
          return match.selector;
        }
        await page.waitForTimeout(step.timeoutMs ?? 1000);
        return { timeoutMs: step.timeoutMs ?? 1000 };
      }

      case "extract": {
        const match = await resolveFirstWorkingSelector(page, step.selectors);
        let extractedValue: string | null;
        if (step.attribute) {
          extractedValue = await match.locator.first().getAttribute(step.attribute);
        } else {
          extractedValue = (await match.locator.first().textContent())?.trim() ?? "";
        }
        variables[step.variableName] = extractedValue;
        return match.selector;
      }

      case "extractRecords": {
        const root: Page | Locator = step.containerSelector
          ? buildLocator(page, step.containerSelector)
          : page;

        const itemLocator = buildLocator(root, step.itemSelector);
        const count = await itemLocator.count();
        const maxItems = step.limit ? Math.min(count, step.limit) : count;
        const records: Array<Record<string, string | null>> = [];

        for (let i = 0; i < maxItems; i++) {
          const itemEl = itemLocator.nth(i);
          const record: Record<string, string | null> = {};

          for (const [fieldName, fieldDef] of Object.entries(step.fields)) {
            try {
              const fieldMatch = await resolveFirstWorkingSelector(itemEl, fieldDef.selectors, 500);
              if (fieldDef.attribute) {
                record[fieldName] = await fieldMatch.locator.first().getAttribute(fieldDef.attribute);
              } else {
                record[fieldName] = (await fieldMatch.locator.first().textContent())?.trim() ?? "";
              }
            } catch {
              record[fieldName] = null;
            }
          }
          records.push(record);
        }

        variables[step.variableName] = records;
        return step.itemSelector;
      }

      default:
        throw new Error(`Unhandled step type: ${(step as any).type}`);
    }
  }
}

/**
 * Converts a WorkflowAst into a standard Capability that can be registered
 * into CapabilityRegistry and automatically exposed to CLI and MCP.
 */
export class WorkflowCapability implements Capability {
  public id: string;
  public name: string;
  public description: string;
  public riskLevel: "read" | "write" | "destructive";
  public inputSchema: z.ZodType<any, any, any>;
  private ast: WorkflowAst;
  private executor: ReplayExecutor;

  constructor(ast: WorkflowAst) {
    this.ast = ast;
    this.id = ast.id;
    this.name = ast.name;
    this.description = ast.description;
    this.riskLevel = ast.riskLevel;
    this.executor = new ReplayExecutor();

    // Dynamically build Zod schema from workflow.inputs
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const input of ast.inputs) {
      let fieldSchema: z.ZodTypeAny;
      if (input.type === "number") {
        fieldSchema = z.number();
      } else if (input.type === "boolean") {
        fieldSchema = z.boolean();
      } else {
        fieldSchema = z.string();
      }

      if (input.description) {
        fieldSchema = fieldSchema.describe(input.description);
      }
      if (input.default !== undefined) {
        fieldSchema = fieldSchema.default(input.default);
      } else if (!input.required) {
        fieldSchema = fieldSchema.optional();
      }
      shape[input.name] = fieldSchema;
    }
    this.inputSchema = z.object(shape);
  }

  async execute(ctx: ExecutionContext, input: any): Promise<Record<string, any>> {
    const result = await this.executor.run(this.ast, ctx.page, input);
    if (result.status === "failed") {
      const failure = result.stepResults.find((s) => s.error);
      throw new Error(`Workflow execution failed on step '${failure?.stepId}': ${failure?.error}`);
    }
    return result.variables;
  }
}
