import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { jitteredWait } from "../../driver/actions.js";
import { userAgentHeader } from "../../driver/browser.js";

export interface ProductHuntPost {
  id: string;
  name: string;
  tagline: string;
  url: string;
  website: string | null;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
}

const GRAPHQL_QUERY = `{
  posts(first: 25, order: RANKING) {
    edges {
      node {
        id
        name
        tagline
        url
        website
        votesCount
        commentsCount
        createdAt
      }
    }
  }
}`;

/**
 * Parses Product Hunt GraphQL API response.
 */
export function parseProductHuntGraphQL(response: any): ProductHuntPost[] {
  if (!response || !response.data || !response.data.posts || !Array.isArray(response.data.posts.edges)) {
    return [];
  }

  const posts: ProductHuntPost[] = [];
  for (const edge of response.data.posts.edges) {
    const node = edge?.node;
    if (!node || !node.name) continue;

    posts.push({
      id: String(node.id),
      name: node.name.trim(),
      tagline: (node.tagline || "").trim(),
      url: node.website?.trim() || node.url?.trim() || "",
      website: node.website?.trim() || null,
      votesCount: typeof node.votesCount === "number" ? node.votesCount : 0,
      commentsCount: typeof node.commentsCount === "number" ? node.commentsCount : 0,
      createdAt: node.createdAt || "",
    });
  }

  return posts;
}

export const producthuntFeedInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of products to return (default 20)"),
  token: z.string().optional().describe("Optional Product Hunt Developer Token (defaults to PRODUCTHUNT_API_TOKEN env)"),
});

export type ProductHuntFeedInput = z.infer<typeof producthuntFeedInputSchema>;

export const producthuntFeedCapability: Capability<ProductHuntFeedInput, ProductHuntPost[]> = {
  id: "producthunt.feed",
  name: "Product Hunt Feed",
  description: "Extract top daily ranked products from Product Hunt via GraphQL API (with token) or browser scraping (zero-auth).",
  riskLevel: "read",
  inputSchema: producthuntFeedInputSchema,

  async execute(ctx: ExecutionContext, input: ProductHuntFeedInput): Promise<ProductHuntPost[]> {
    const token = input.token || process.env.PRODUCTHUNT_API_TOKEN;

    // Strategy 1: If a Developer Token is available, use official GraphQL API
    if (token) {
      try {
        const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...userAgentHeader(),
          },
          body: JSON.stringify({ query: GRAPHQL_QUERY }),
        });

        if (res.ok) {
          const json = await res.json();
          const posts = parseProductHuntGraphQL(json);
          if (posts.length > 0) {
            return posts.slice(0, input.limit);
          }
        }
      } catch {
        // Fall back to browser-rendered extraction
      }
    }

    // Strategy 2: Zero-auth browser scraping of Product Hunt's front page
    const page = ctx.page;
    await page.goto("https://www.producthunt.com", { waitUntil: "domcontentloaded" });
    await jitteredWait(1000, 500);

    // Wait for post items or links to appear
    await page
      .waitForSelector("[data-test='post-item'], a[href*='/posts/']", { timeout: 7000 })
      .catch(() => {});

    const scrapedPosts = await page.evaluate(() => {
      const results: {
        id: string;
        name: string;
        tagline: string;
        url: string;
        votesCount: number;
        commentsCount: number;
      }[] = [];

      // Find post item containers or anchors
      const postContainers = Array.from(
        document.querySelectorAll("[data-test='post-item'], [data-test^='post-row-'], div[class*='styles_item__']")
      );

      for (const container of postContainers) {
        const titleEl = container.querySelector("a[data-test*='post-name'], a[href*='/posts/'] strong, h3, [class*='title']");
        const linkEl = container.querySelector<HTMLAnchorElement>("a[data-test*='post-name'], a[href*='/posts/']");
        const taglineEl = container.querySelector("[class*='tagline'], [class*='description'], p");
        const voteEl = container.querySelector("[data-test='vote-button'] [class*='vote-count'], button[class*='vote']");
        const commentEl = container.querySelector("a[href*='/posts/'][class*='comment'], [data-test='comments']");

        const name = titleEl?.textContent?.trim() || "";
        const href = linkEl?.getAttribute("href") || "";
        if (!name || !href) continue;

        const tagline = taglineEl?.textContent?.trim() || "";
        const voteText = voteEl?.textContent?.trim() || "0";
        const votes = Number.parseInt(voteText.replace(/[^0-9]/g, "") || "0", 10);

        const commentText = commentEl?.textContent?.trim() || "0";
        const comments = Number.parseInt(commentText.replace(/[^0-9]/g, "") || "0", 10);

        const idMatch = href.match(/\/posts\/([a-zA-Z0-9_-]+)/);
        const id = (idMatch && idMatch[1]) ? idMatch[1] : href;

        results.push({
          id,
          name,
          tagline,
          url: href.startsWith("http") ? href : `https://www.producthunt.com${href}`,
          votesCount: Number.isNaN(votes) ? 0 : votes,
          commentsCount: Number.isNaN(comments) ? 0 : comments,
        });
      }

      return results;
    });

    const finalResults: ProductHuntPost[] = scrapedPosts.map((p) => ({
      ...p,
      website: null,
      createdAt: new Date().toISOString(),
    }));

    return finalResults.slice(0, input.limit);
  },
};
