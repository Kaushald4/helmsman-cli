import type { RiskLevel } from "../capabilities/types.js";

export interface AuditEntry {
  id: string;
  timestamp: string;
  workflowId: string;
  domain: string;
  riskLevel: RiskLevel;
  status: "success" | "failed" | "blocked";
  durationMs: number;
  source: "cli" | "mcp" | "script";
  error?: string;
}

export interface AuditQueryFilter {
  workflowId?: string;
  domain?: string;
  status?: AuditEntry["status"];
  since?: string;
}

export interface AggregatedMetrics {
  totalInvocations: number;
  successful: number;
  failed: number;
  blocked: number;
  averageDurationMs: number;
  byWorkflow: Record<string, { total: number; successRate: number }>;
}
