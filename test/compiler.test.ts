import { describe, it, expect } from "vitest";
import {
  compileWorkflow,
  normalizeEvents,
  optimizeEvents,
} from "../src/workflow/compiler.js";
import type { RawInteractionEvent } from "../src/workflow/recorder.js";

describe("Workflow Compiler & Optimizer", () => {
  it("should normalize redundant navigations", () => {
    const raw: RawInteractionEvent[] = [
      { kind: "navigate", url: "about:blank", timestamp: "1" },
      { kind: "navigate", url: "https://example.com", timestamp: "2" },
      { kind: "navigate", url: "https://example.com", timestamp: "3" },
      { kind: "navigate", url: "https://example.com/checkout", timestamp: "4" },
    ];

    const normalized = normalizeEvents(raw);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.url).toBe("https://example.com");
    expect(normalized[1]?.url).toBe("https://example.com/checkout");
  });

  it("should optimize consecutive fills on the same field", () => {
    const raw: RawInteractionEvent[] = [
      {
        kind: "fill",
        url: "https://example.com",
        timestamp: "1",
        selectors: [{ strategy: "css", value: "#email" }],
        value: "kaushal",
      },
      {
        kind: "fill",
        url: "https://example.com",
        timestamp: "2",
        selectors: [{ strategy: "css", value: "#email" }],
        value: "kaushal@example.com",
      },
    ];

    const optimized = optimizeEvents(raw);
    expect(optimized).toHaveLength(1);
    expect(optimized[0]?.value).toBe("kaushal@example.com");
  });

  it("should infer destructive risk level when destructive action is clicked", () => {
    const raw: RawInteractionEvent[] = [
      { kind: "navigate", url: "https://example.com/settings", timestamp: "1" },
      {
        kind: "click",
        url: "https://example.com/settings",
        timestamp: "2",
        selectors: [{ strategy: "css", value: ".btn-danger" }],
        accessibleName: "Delete account permanently",
      },
    ];

    const ast = compileWorkflow(raw, { id: "user.deleteAccount" });
    expect(ast.riskLevel).toBe("destructive");
    expect(ast.steps).toHaveLength(2);
    expect(ast.steps[1]?.intent).toContain("Delete account permanently");
  });

  it("should parameterize fills into declared workflow inputs", () => {
    const raw: RawInteractionEvent[] = [
      { kind: "navigate", url: "https://example.com/login", timestamp: "1" },
      {
        kind: "fill",
        url: "https://example.com/login",
        timestamp: "2",
        selectors: [{ strategy: "label", value: "Username" }],
        value: "admin",
        accessibleName: "Username",
      },
    ];

    const ast = compileWorkflow(raw, {
      id: "auth.login",
      parameterizeFills: true,
    });

    expect(ast.inputs).toHaveLength(1);
    expect(ast.inputs[0]?.name).toBe("username");
    expect(ast.inputs[0]?.default).toBe("admin");
    expect(ast.steps[1]?.type).toBe("fill");
    if (ast.steps[1]?.type === "fill") {
      expect(ast.steps[1].value).toBe("{{username}}");
    }
  });

  it("should merge consecutive scrolls and compile scroll steps into the AST", () => {
    const raw: RawInteractionEvent[] = [
      { kind: "navigate", url: "https://example.com", timestamp: "1" },
      { kind: "scroll", url: "https://example.com", timestamp: "2", scrollDeltaY: 300, scrollDeltaX: 0 },
      { kind: "scroll", url: "https://example.com", timestamp: "3", scrollDeltaY: 450, scrollDeltaX: 0 },
      {
        kind: "click",
        url: "https://example.com",
        timestamp: "4",
        selectors: [{ strategy: "text", value: "Algorithms" }],
        accessibleName: "Algorithms",
      },
    ];

    const ast = compileWorkflow(raw, { id: "algo.browse" });
    expect(ast.steps).toHaveLength(3);
    expect(ast.steps[0]?.type).toBe("goto");
    expect(ast.steps[1]?.type).toBe("scroll");
    if (ast.steps[1]?.type === "scroll") {
      expect(ast.steps[1].deltaY).toBe(750);
      expect(ast.steps[1].intent).toContain("Scroll down 750px");
    }
    expect(ast.steps[2]?.type).toBe("click");
  });

  it("should compile hover step before dropdown item click and optimize redundant hover", () => {
    // Case 1: Hover on dropdown menu "Courses", then click "DSA Course"
    const raw: RawInteractionEvent[] = [
      { kind: "navigate", url: "https://example.com", timestamp: "1" },
      {
        kind: "hover",
        url: "https://example.com",
        timestamp: "2",
        selectors: [{ strategy: "role", role: "button", name: "Courses" }],
        accessibleName: "Courses",
      },
      {
        kind: "click",
        url: "https://example.com",
        timestamp: "3",
        selectors: [{ strategy: "text", value: "DSA Course" }],
        accessibleName: "DSA Course",
      },
    ];

    const ast = compileWorkflow(raw, { id: "algo.dsa" });
    expect(ast.steps).toHaveLength(3);
    expect(ast.steps[0]?.type).toBe("goto");
    expect(ast.steps[1]?.type).toBe("hover");
    expect(ast.steps[2]?.type).toBe("click");

    // Case 2: Hover on button and click the exact same button (subsumption)
    const redundantHover: RawInteractionEvent[] = [
      {
        kind: "hover",
        url: "https://example.com",
        timestamp: "1",
        selectors: [{ strategy: "text", value: "Sign In" }],
        accessibleName: "Sign In",
      },
      {
        kind: "click",
        url: "https://example.com",
        timestamp: "2",
        selectors: [{ strategy: "text", value: "Sign In" }],
        accessibleName: "Sign In",
      },
    ];

    const opt = compileWorkflow(redundantHover, { id: "algo.signin" });
    expect(opt.steps).toHaveLength(1);
    expect(opt.steps[0]?.type).toBe("click");
  });
});
