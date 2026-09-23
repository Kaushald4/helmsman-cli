import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { AuditEntry, AuditQueryFilter, AggregatedMetrics } from "./types.js";

export class AuditWriter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ??
      path.join(process.env.HELMSMAN_HOME ?? path.join(os.homedir(), ".helmsman"), "audit");
  }

  private getLogFilePath(date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return path.join(this.baseDir, `${yyyy}-${mm}-${dd}.jsonl`);
  }

  /**
   * Appends an execution or policy event to the durable audit log.
   */
  append(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    fs.mkdirSync(this.baseDir, { recursive: true });

    const fullEntry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const filePath = this.getLogFilePath();
    fs.appendFileSync(filePath, `${JSON.stringify(fullEntry)}\n`, "utf8");
    return fullEntry;
  }

  /**
   * Reads all available audit entries across log files matching the filter.
   */
  query(filter: AuditQueryFilter = {}): AuditEntry[] {
    if (!fs.existsSync(this.baseDir)) return [];

    const files = fs
      .readdirSync(this.baseDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();

    const results: AuditEntry[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.baseDir, file), "utf8");
      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditEntry;

          if (filter.workflowId && entry.workflowId !== filter.workflowId) continue;
          if (filter.domain && entry.domain !== filter.domain) continue;
          if (filter.status && entry.status !== filter.status) continue;
          if (filter.since && new Date(entry.timestamp) < new Date(filter.since)) continue;

          results.push(entry);
        } catch {
          // Skip corrupt line
        }
      }
    }

    return results;
  }

  /**
   * Computes aggregated performance and outcome metrics from audit entries.
   */
  computeMetrics(entries: AuditEntry[]): AggregatedMetrics {
    const total = entries.length;
    let successful = 0;
    let failed = 0;
    let blocked = 0;
    let totalDuration = 0;
    const byWorkflow: Record<string, { total: number; successful: number }> = {};

    for (const e of entries) {
      if (e.status === "success") successful++;
      if (e.status === "failed") failed++;
      if (e.status === "blocked") blocked++;
      totalDuration += e.durationMs || 0;

      if (!byWorkflow[e.workflowId]) {
        byWorkflow[e.workflowId] = { total: 0, successful: 0 };
      }
      byWorkflow[e.workflowId]!.total++;
      if (e.status === "success") {
        byWorkflow[e.workflowId]!.successful++;
      }
    }

    const workflowSummary: Record<string, { total: number; successRate: number }> = {};
    for (const [id, stats] of Object.entries(byWorkflow)) {
      workflowSummary[id] = {
        total: stats.total,
        successRate: stats.total > 0 ? stats.successful / stats.total : 0,
      };
    }

    return {
      totalInvocations: total,
      successful,
      failed,
      blocked,
      averageDurationMs: total > 0 ? Math.round(totalDuration / total) : 0,
      byWorkflow: workflowSummary,
    };
  }
}

export const defaultAuditWriter = new AuditWriter();
