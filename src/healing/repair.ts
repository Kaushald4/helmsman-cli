import fs from "node:fs";
import type { Page } from "playwright-core";
import type { WorkflowAst, WorkflowStep } from "../workflow/ast.js";
import { ReplayExecutor, type WorkflowExecutionResult } from "../workflow/replay.js";
import { serializeWorkflow } from "../workflow/serializer.js";
import type { Resolver, ResolvedSelector } from "./types.js";
import { DomResolver } from "./resolvers/dom.js";
import { AccessibilityResolver } from "./resolvers/accessibility.js";
import { LlmResolver } from "./resolvers/llm.js";

export interface RepairOptions {
  workflowFilePath?: string;
  enableLlm?: boolean;
  speed?: "human" | "fast" | "instant";
  interStepDelayMs?: number;
}

export class RepairExecutor {
  private resolvers: Resolver[];
  private replayExecutor: ReplayExecutor;

  constructor(options: { enableLlm?: boolean } = {}) {
    this.resolvers = [new DomResolver(), new AccessibilityResolver()];
    if (options.enableLlm !== false) {
      this.resolvers.push(new LlmResolver());
    }
    this.replayExecutor = new ReplayExecutor();
  }

  async run(
    ast: WorkflowAst,
    page: Page,
    inputs: Record<string, any> = {},
    options: RepairOptions = {}
  ): Promise<WorkflowExecutionResult & { healed: boolean; healedWorkflow?: WorkflowAst }> {
    const { jitteredWait } = await import("../driver/actions.js");
    const speed = options.speed ?? "human";
    const startTime = Date.now();
    const variables: Record<string, any> = { ...inputs };
    const stepResults: WorkflowExecutionResult["stepResults"] = [];
    let healedAny = false;

    // Deep clone steps so we can safely mutate during healing
    const clonedAst: WorkflowAst = JSON.parse(JSON.stringify(ast));

    for (let i = 0; i < clonedAst.steps.length; i++) {
      const step = clonedAst.steps[i]!;

      if (i > 0) {
        if (options.interStepDelayMs !== undefined) {
          await new Promise((r) => setTimeout(r, options.interStepDelayMs));
        } else if (speed === "human") {
          await jitteredWait(450, 400);
        } else if (speed === "fast") {
          await jitteredWait(80, 80);
        }
      }

      const stepStart = Date.now();
      try {
        const resolved = await this.replayExecutor.dispatchStep(step, page, variables, speed);
        stepResults.push({
          stepId: step.id,
          type: step.type,
          durationMs: Date.now() - stepStart,
          resolvedSelector: resolved,
        });
      } catch (originalError) {
        // Step failed! Attempt tiered self-healing
        const staleSelectors = (step as any).selectors ?? [];
        let repairSuccess = false;

        if (staleSelectors.length > 0) {
          for (const resolver of this.resolvers) {
            try {
              const resolution = await resolver.resolve({
                page,
                step,
                staleSelectors,
                error: originalError instanceof Error ? originalError : new Error(String(originalError)),
              });

              if (!resolution) continue;

              // Verify: NEVER trust discovery alone! Re-execute the step for real on the page.
              const testPatchedStep: WorkflowStep = {
                ...step,
                selectors: [resolution.selector],
              } as any;

              await this.replayExecutor.dispatchStep(testPatchedStep, page, variables);

              // Retry succeeded! Commit the heal
              repairSuccess = true;
              healedAny = true;

              const oldSelector = staleSelectors[0]!;
              (step as any).selectors = [resolution.selector];
              clonedAst.version = (clonedAst.version ?? 1) + 1;
              clonedAst.healingHistory ??= [];
              clonedAst.healingHistory.push({
                timestamp: new Date().toISOString(),
                stepId: step.id,
                oldSelector,
                newSelector: resolution.selector,
                tier: resolution.tier,
                confidence: resolution.confidence,
              });

              stepResults.push({
                stepId: step.id,
                type: step.type,
                durationMs: Date.now() - stepStart,
                resolvedSelector: resolution.selector,
              });
              break;
            } catch {
              // Resolution candidate failed actual browser execution; try next tier
            }
          }
        }

        if (!repairSuccess) {
          const errorMessage = originalError instanceof Error ? originalError.message : String(originalError);
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
            healed: healedAny,
            healedWorkflow: healedAny ? clonedAst : undefined,
          };
        }
      }
    }

    // If healed and file path provided, write patched YAML back to disk ("Pay once")
    if (healedAny && options.workflowFilePath && fs.existsSync(options.workflowFilePath)) {
      try {
        const patchedYaml = serializeWorkflow(clonedAst);
        fs.writeFileSync(options.workflowFilePath, patchedYaml, "utf8");
      } catch {
        // Disk write failed, proceed with memory state
      }
    }

    return {
      workflowId: ast.id,
      status: "success",
      variables,
      stepResults,
      totalDurationMs: Date.now() - startTime,
      healed: healedAny,
      healedWorkflow: healedAny ? clonedAst : undefined,
    };
  }
}
