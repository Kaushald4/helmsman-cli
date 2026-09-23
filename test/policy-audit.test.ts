import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PolicyGate, PolicyViolationError } from "../src/policy/gate.js";
import { AuditWriter } from "../src/audit/writer.js";

describe("PolicyGate", () => {
  it("should allow safe read actions without confirmation", async () => {
    const gate = new PolicyGate();
    await expect(
      gate.check({ id: "test.read", domain: "example.com", riskLevel: "read" })
    ).resolves.not.toThrow();
  });

  it("should require confirmation for destructive actions", async () => {
    const gate = new PolicyGate();
    await expect(
      gate.check({ id: "test.delete", domain: "example.com", riskLevel: "destructive" })
    ).rejects.toThrow(PolicyViolationError);
  });

  it("should allow destructive action if confirmation provider confirms", async () => {
    const gate = new PolicyGate();
    const provider = { confirm: async () => true };
    await expect(
      gate.check({ id: "test.delete", domain: "example.com", riskLevel: "destructive" }, provider)
    ).resolves.not.toThrow();
  });

  it("should block action if confirmation provider rejects", async () => {
    const gate = new PolicyGate();
    const provider = { confirm: async () => false };
    await expect(
      gate.check({ id: "test.delete", domain: "example.com", riskLevel: "destructive" }, provider)
    ).rejects.toThrow("Action 'test.delete' was rejected by confirmation gate.");
  });

  it("should enforce domain rate limits", async () => {
    const gate = new PolicyGate({
      defaults: { allowedRiskLevels: ["read"] },
      sites: {
        "fast.com": {
          rateLimit: { requestsPerMinute: 2 },
        },
      },
    });

    // 1st request ok
    await gate.check({ id: "test.r1", domain: "fast.com", riskLevel: "read" });
    // 2nd request ok
    await gate.check({ id: "test.r2", domain: "fast.com", riskLevel: "read" });
    // 3rd request should exceed rate limit
    await expect(
      gate.check({ id: "test.r3", domain: "fast.com", riskLevel: "read" })
    ).rejects.toThrow("Rate limit of 2 req/min exceeded");
  });
});

describe("AuditWriter", () => {
  let tmpDir: string;
  let writer: AuditWriter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helmsman-audit-test-"));
    writer = new AuditWriter(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should append entries and query them back", () => {
    writer.append({
      workflowId: "github.viewRepo",
      domain: "github.com",
      riskLevel: "read",
      status: "success",
      durationMs: 450,
      source: "cli",
    });

    writer.append({
      workflowId: "github.deleteRepo",
      domain: "github.com",
      riskLevel: "destructive",
      status: "blocked",
      durationMs: 10,
      source: "mcp",
      error: "Blocked by policy",
    });

    const all = writer.query();
    expect(all).toHaveLength(2);

    const blockedOnly = writer.query({ status: "blocked" });
    expect(blockedOnly).toHaveLength(1);
    expect(blockedOnly[0]?.workflowId).toBe("github.deleteRepo");
  });

  it("should compute aggregated metrics", () => {
    writer.append({
      workflowId: "test.flow",
      domain: "example.com",
      riskLevel: "read",
      status: "success",
      durationMs: 200,
      source: "cli",
    });
    writer.append({
      workflowId: "test.flow",
      domain: "example.com",
      riskLevel: "read",
      status: "failed",
      durationMs: 400,
      source: "cli",
    });

    const entries = writer.query();
    const metrics = writer.computeMetrics(entries);

    expect(metrics.totalInvocations).toBe(2);
    expect(metrics.successful).toBe(1);
    expect(metrics.failed).toBe(1);
    expect(metrics.averageDurationMs).toBe(300);
    expect(metrics.byWorkflow["test.flow"]?.successRate).toBe(0.5);
  });
});
