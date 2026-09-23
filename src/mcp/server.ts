import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CapabilityRegistry } from "../capabilities/registry.js";
import { defaultRegistry } from "../capabilities/registry.js";
import { BrowserDriver } from "../driver/browser.js";
import { registerBuiltins } from "../capabilities/builtins/index.js";
import { PolicyGate } from "../policy/gate.js";
import { defaultAuditWriter } from "../audit/writer.js";

export interface McpServerOptions {
  registry?: CapabilityRegistry;
  profileName?: string;
  headless?: boolean;
}

interface PendingConfirmation {
  token: string;
  capabilityId: string;
  input: any;
  createdAt: string;
}

/**
 * Creates and configures the native Model Context Protocol (MCP) server,
 * dynamically registering every capability as a first-class MCP tool
 * along with Policy safety gates and durable Audit logging.
 */
export async function createMcpServer(options: McpServerOptions = {}): Promise<McpServer> {
  const registry = options.registry ?? defaultRegistry;
  const profileName = options.profileName ?? "default";
  const headless = options.headless ?? true;
  const driver = new BrowserDriver();
  const policyGate = new PolicyGate();
  const pendingConfirmations = new Map<string, PendingConfirmation>();

  const server = new McpServer({
    name: "helmsman",
    version: "0.2.0",
  });

  for (const capability of registry.list()) {
    const toolName = capability.id.replace(/\./g, "_");
    const domain = capability.id.split(".")[0] || "general";

    const schemaShape =
      capability.inputSchema instanceof z.ZodObject
        ? (capability.inputSchema as z.ZodObject<any>).shape
        : {};

    server.registerTool(
      toolName,
      {
        description: `[Risk: ${capability.riskLevel}] ${capability.description}`,
        inputSchema: schemaShape,
      },
      async (args: Record<string, unknown>) => {
        const start = Date.now();

        // 1. Policy Gate: Check if confirmation required
        const target = { id: capability.id, domain, riskLevel: capability.riskLevel };
        if (policyGate.requiresConfirmation(target)) {
          const token = crypto.randomUUID();
          pendingConfirmations.set(token, {
            token,
            capabilityId: capability.id,
            input: args,
            createdAt: new Date().toISOString(),
          });

          defaultAuditWriter.append({
            workflowId: capability.id,
            domain,
            riskLevel: capability.riskLevel,
            status: "blocked",
            durationMs: Date.now() - start,
            source: "mcp",
            error: "Pending user confirmation",
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "confirmation_required",
                    token,
                    message: `This is a '${capability.riskLevel}' action. Call 'confirm_action' with token '${token}' to proceed.`,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: false,
          };
        }

        try {
          const validatedInput = capability.inputSchema.parse(args);
          const page = await driver.getPage(profileName, { headless });

          const result = await capability.execute(
            {
              page,
              driver,
              profileName,
            },
            validatedInput
          );

          defaultAuditWriter.append({
            workflowId: capability.id,
            domain,
            riskLevel: capability.riskLevel,
            status: "success",
            durationMs: Date.now() - start,
            source: "mcp",
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          defaultAuditWriter.append({
            workflowId: capability.id,
            domain,
            riskLevel: capability.riskLevel,
            status: "failed",
            durationMs: Date.now() - start,
            source: "mcp",
            error: errorMessage,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: errorMessage }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // FIXED SYSTEM TOOLS (confirm_action, audit_query, metrics_query)
  // -------------------------------------------------------------------------
  server.registerTool(
    "confirm_action",
    {
      description: "Confirm and execute an action that returned 'confirmation_required'",
      inputSchema: { token: z.string().describe("Confirmation token provided by the pending tool call") },
    },
    async ({ token }: { token: string }) => {
      const pending = pendingConfirmations.get(token);
      if (!pending) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid or expired confirmation token" }) }],
          isError: true,
        };
      }
      pendingConfirmations.delete(token);

      const capability = registry.get(pending.capabilityId);
      if (!capability) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Capability no longer available" }) }],
          isError: true,
        };
      }

      const start = Date.now();
      const domain = capability.id.split(".")[0] || "general";

      try {
        const validatedInput = capability.inputSchema.parse(pending.input);
        const page = await driver.getPage(profileName, { headless });
        const result = await capability.execute({ page, driver, profileName }, validatedInput);

        defaultAuditWriter.append({
          workflowId: capability.id,
          domain,
          riskLevel: capability.riskLevel,
          status: "success",
          durationMs: Date.now() - start,
          source: "mcp",
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          isError: false,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "audit_query",
    {
      description: "Query execution audit logs with optional filters",
      inputSchema: {
        workflowId: z.string().optional(),
        status: z.enum(["success", "failed", "blocked"]).optional(),
      },
    },
    async (args: { workflowId?: string; status?: "success" | "failed" | "blocked" }) => {
      const entries = defaultAuditWriter.query(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }],
        isError: false,
      };
    }
  );

  server.registerTool(
    "metrics_query",
    {
      description: "Query runtime metrics including total invocations and success rates",
      inputSchema: {},
    },
    async () => {
      const entries = defaultAuditWriter.query();
      const metrics = defaultAuditWriter.computeMetrics(entries);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }],
        isError: false,
      };
    }
  );

  return server;
}

/**
 * Starts the MCP server on stdio transport for agent hosts.
 */
export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  registerBuiltins();
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
