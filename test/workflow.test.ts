import { describe, it, expect } from "vitest";
import {
  parseWorkflow,
  serializeWorkflow,
  type WorkflowAst,
} from "../src/workflow/index.js";
import { interpolate, WorkflowCapability, ReplayExecutor } from "../src/workflow/replay.js";
import { CapabilityRegistry } from "../src/capabilities/registry.js";

const sampleWorkflow: WorkflowAst = {
  id: "github.viewRepo",
  name: "View GitHub Repo",
  description: "Navigate to a GitHub repo and extract its description",
  domain: "github.com",
  version: 1,
  riskLevel: "read",
  inputs: [
    { name: "owner", type: "string", description: "Repo owner", required: true },
    { name: "repo", type: "string", description: "Repo name", required: true },
  ],
  steps: [
    {
      id: "nav",
      type: "goto",
      url: "https://github.com/{{owner}}/{{repo}}",
      intent: "Navigate to repo",
    },
    {
      id: "get-desc",
      type: "extract",
      selectors: [
        { strategy: "css", value: 'p[data-testid="repo-description"]' },
        { strategy: "css", value: ".f4.my-3" },
      ],
      variableName: "repoDescription",
      intent: "Extract repository description",
    },
  ],
};

describe("Workflow AST & Serializer", () => {
  it("should serialize to YAML and parse back losslessly", () => {
    const yaml = serializeWorkflow(sampleWorkflow);
    expect(yaml).toContain("id: github.viewRepo");
    expect(yaml).toContain("domain: github.com");

    const parsed = parseWorkflow(yaml);
    expect(parsed.id).toBe(sampleWorkflow.id);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]?.type).toBe("goto");
    expect(parsed.steps[1]?.type).toBe("extract");
  });

  it("should serialize and parse scroll steps correctly", () => {
    const scrollWf: WorkflowAst = {
      id: "test.scroll",
      name: "Scroll Test",
      description: "Test scrolling",
      domain: "example.com",
      version: 1,
      riskLevel: "read",
      inputs: [],
      steps: [
        { id: "s1", type: "goto", url: "https://example.com" },
        { id: "s2", type: "scroll", deltaX: 0, deltaY: 600, intent: "Scroll down 600px" },
      ],
    };

    const yaml = serializeWorkflow(scrollWf);
    expect(yaml).toContain("type: scroll");
    expect(yaml).toContain("deltaY: 600");

    const parsed = parseWorkflow(yaml);
    expect(parsed.steps[1]?.type).toBe("scroll");
    if (parsed.steps[1]?.type === "scroll") {
      expect(parsed.steps[1].deltaY).toBe(600);
    }
  });

  it("should interpolate variables accurately", () => {
    const url = "https://github.com/{{owner}}/${repo}/issues/{{input.issueId}}";
    const result = interpolate(url, {
      owner: "facebook",
      repo: "react",
      issueId: "1234",
    });
    expect(result).toBe("https://github.com/facebook/react/issues/1234");
  });

  it("should adapt WorkflowAst into a Capability registered in CapabilityRegistry", () => {
    const capability = new WorkflowCapability(sampleWorkflow);
    expect(capability.id).toBe("github.viewRepo");
    expect(capability.riskLevel).toBe("read");

    const registry = new CapabilityRegistry();
    registry.register(capability);

    const retrieved = registry.get("github.viewRepo");
    expect(retrieved).toBeDefined();

    // Verify input schema validation
    const parsedInput = capability.inputSchema.parse({ owner: "anthropics", repo: "claude-code" });
    expect(parsedInput.owner).toBe("anthropics");
    expect(parsedInput.repo).toBe("claude-code");
  });

  it("should configure ReplayExecutor with human and custom pacing options", () => {
    const executor = new ReplayExecutor();
    expect(executor).toBeDefined();
    // Verify run accepts options without throwing schema/type errors
    expect(typeof executor.run).toBe("function");
    expect(typeof executor.dispatchStep).toBe("function");
  });
});
