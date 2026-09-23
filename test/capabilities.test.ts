import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "../src/capabilities/registry.js";
import { redditFeedCapability, redditFeedInputSchema } from "../src/capabilities/builtins/reddit.js";

describe("CapabilityRegistry", () => {
  it("should register and retrieve a capability", () => {
    const registry = new CapabilityRegistry();
    registry.register(redditFeedCapability);

    const fetched = registry.get("reddit.feed");
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe("reddit.feed");
    expect(fetched?.riskLevel).toBe("read");
  });

  it("should throw when registering a duplicate capability id", () => {
    const registry = new CapabilityRegistry();
    registry.register(redditFeedCapability);

    expect(() => registry.register(redditFeedCapability)).toThrowError(
      "Capability with id 'reddit.feed' is already registered."
    );
  });

  it("should list capabilities by namespace", () => {
    const registry = new CapabilityRegistry();
    registry.register(redditFeedCapability);

    const redditCaps = registry.listByNamespace("reddit");
    expect(redditCaps).toHaveLength(1);
    expect(redditCaps[0]?.id).toBe("reddit.feed");

    const twitterCaps = registry.listByNamespace("twitter");
    expect(twitterCaps).toHaveLength(0);
  });
});

describe("Reddit Capability Schema", () => {
  it("should validate and apply default inputs", () => {
    const result = redditFeedInputSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.sort).toBe("hot");
  });

  it("should parse custom parameters correctly", () => {
    const result = redditFeedInputSchema.parse({
      limit: 50,
      subreddit: "r/typescript",
      sort: "new",
    });
    expect(result.limit).toBe(50);
    expect(result.subreddit).toBe("r/typescript");
    expect(result.sort).toBe("new");
  });

  it("should reject invalid limit boundaries", () => {
    expect(() => redditFeedInputSchema.parse({ limit: 0 })).toThrow();
    expect(() => redditFeedInputSchema.parse({ limit: 500 })).toThrow();
  });
});
