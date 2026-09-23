import { defaultRegistry } from "../registry.js";
import { redditFeedCapability } from "./reddit.js";
import { twitterFeedCapability, twitterSearchCapability } from "./twitter.js";
import { hackernewsFeedCapability, hackernewsSearchCapability } from "./hackernews.js";
import { linkedinJobsCapability, linkedinFeedCapability } from "./linkedin.js";
import { huggingfaceCommunityCapability, huggingfacePapersCapability } from "./huggingface.js";
import { lobstersFeedCapability } from "./lobsters.js";
import { devtoArticlesCapability } from "./devto.js";
import { producthuntFeedCapability } from "./producthunt.js";
import { arxivPapersCapability } from "./arxiv.js";
import { rssFeedCapability } from "./rss.js";

export * from "./reddit.js";
export * from "./twitter.js";
export * from "./hackernews.js";
export * from "./linkedin.js";
export * from "./huggingface.js";
export * from "./lobsters.js";
export * from "./devto.js";
export * from "./producthunt.js";
export * from "./arxiv.js";
export * from "./rss.js";

/**
 * Initializes and registers all built-in platform extractors.
 */
export function registerBuiltins(): void {
  defaultRegistry.register(redditFeedCapability);
  defaultRegistry.register(twitterFeedCapability);
  defaultRegistry.register(twitterSearchCapability);
  defaultRegistry.register(hackernewsFeedCapability);
  defaultRegistry.register(hackernewsSearchCapability);
  defaultRegistry.register(linkedinJobsCapability);
  defaultRegistry.register(linkedinFeedCapability);
  defaultRegistry.register(huggingfaceCommunityCapability);
  defaultRegistry.register(huggingfacePapersCapability);
  defaultRegistry.register(lobstersFeedCapability);
  defaultRegistry.register(devtoArticlesCapability);
  defaultRegistry.register(producthuntFeedCapability);
  defaultRegistry.register(arxivPapersCapability);
  defaultRegistry.register(rssFeedCapability);
}
