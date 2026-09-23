import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { userAgentHeader } from "../../driver/browser.js";

export interface DevToArticle {
  id: string;
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
  author: string;
  authorUrl: string | null;
  reactionsCount: number;
  commentsCount: number;
  tags: string[];
  coverImage: string | null;
}

export function parseDevToArticles(data: any): DevToArticle[] {
  if (!Array.isArray(data)) return [];
  const results: DevToArticle[] = [];

  for (const a of data) {
    if (!a || !a.id || !a.title) continue;

    const tags: string[] = [];
    if (Array.isArray(a.tag_list)) {
      tags.push(...a.tag_list.map(String));
    } else if (typeof a.tags === "string") {
      tags.push(...a.tags.split(",").map((t: string) => t.trim()).filter(Boolean));
    }

    results.push({
      id: String(a.id),
      title: a.title.trim(),
      description: a.description ? a.description.trim() : null,
      url: a.url || `https://dev.to/${a.path || a.id}`,
      publishedAt: a.published_timestamp || a.published_at || "",
      author: a.user?.name || a.user?.username || "Dev.to User",
      authorUrl: a.user?.username ? `https://dev.to/${a.user.username}` : null,
      reactionsCount: typeof a.positive_reactions_count === "number" ? a.positive_reactions_count : (typeof a.public_reactions_count === "number" ? a.public_reactions_count : 0),
      commentsCount: typeof a.comments_count === "number" ? a.comments_count : 0,
      tags,
      coverImage: a.cover_image || null,
    });
  }

  return results;
}

export const devtoArticlesInputSchema = z.object({
  tag: z.string().optional().describe("Tag to filter by (e.g. 'ai', 'webdev', 'javascript')"),
  top: z.string().default("7").describe("Time window for top articles in days ('7', '30', '365', or 'infinity')"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of articles to return (default 20)"),
});

export type DevToArticlesInput = z.infer<typeof devtoArticlesInputSchema>;

export const devtoArticlesCapability: Capability<DevToArticlesInput, DevToArticle[]> = {
  id: "devto.articles",
  name: "Dev.to Articles",
  description: "Extract top technical articles, tutorials, and discussions from Dev.to with optional tag filtering.",
  riskLevel: "read",
  inputSchema: devtoArticlesInputSchema,

  async execute(ctx: ExecutionContext, input: DevToArticlesInput): Promise<DevToArticle[]> {
    const params = new URLSearchParams();
    params.set("per_page", String(Math.min(input.limit, 100)));

    if (input.top && input.top !== "latest") {
      params.set("top", input.top);
    }
    if (input.tag) {
      params.set("tag", input.tag.replace(/^#/, "").trim());
    }

    const apiUrl = `https://dev.to/api/articles?${params.toString()}`;

    // Direct HTTP fetch first
    try {
      const res = await fetch(apiUrl, {
        headers: {
          ...userAgentHeader(),
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = parseDevToArticles(data);
        if (parsed.length > 0) {
          return parsed.slice(0, input.limit);
        }
      }
    } catch {
      // Fall through to browser execution
    }

    // In-browser execution fallback
    const page = ctx.page;
    const webUrl = input.tag
      ? `https://dev.to/t/${encodeURIComponent(input.tag.toLowerCase())}`
      : "https://dev.to/top/week";

    await page.goto(webUrl, { waitUntil: "domcontentloaded" });

    // Fetch API within browser context
    try {
      const browserJson = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        return await r.json();
      }, apiUrl);

      if (browserJson) {
        const parsed = parseDevToArticles(browserJson);
        if (parsed.length > 0) {
          return parsed.slice(0, input.limit);
        }
      }
    } catch {
      // Fall through to DOM extraction
    }

    // Fallback: Scrape article cards from HTML DOM
    const domArticles = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".crayons-story, article"));
      return cards.map((card, idx) => {
        const titleEl = card.querySelector("h2.crayons-story__title a, a[id*='article-link']");
        const title = titleEl?.textContent?.trim() || "";
        const href = titleEl?.getAttribute("href") || "";
        const authorEl = card.querySelector("a[data-user-id], .crayons-story__secondary-fw a");
        const author = authorEl?.textContent?.trim() || "Dev.to";
        const authorHref = authorEl?.getAttribute("href") || null;
        const timeEl = card.querySelector("time");
        const publishedAt = timeEl?.getAttribute("datetime") || "";
        const reactionsEl = card.querySelector("[data-testid='story-reaction-count'], .aggregate_reactions_counter");
        const reactionsText = reactionsEl?.textContent?.trim() || "0";
        const reactions = Number.parseInt(reactionsText.replace(/[^0-9]/g, "") || "0", 10);
        const commentsLink = card.querySelector("a[href*='#comments']");
        const commentsText = commentsLink?.textContent?.trim() || "0";
        const comments = Number.parseInt(commentsText.replace(/[^0-9]/g, "") || "0", 10);

        return {
          id: String(idx + 1),
          title,
          url: href.startsWith("http") ? href : `https://dev.to${href}`,
          published_timestamp: publishedAt,
          positive_reactions_count: Number.isNaN(reactions) ? 0 : reactions,
          comments_count: Number.isNaN(comments) ? 0 : comments,
          user: { name: author, username: authorHref ? authorHref.replace(/^\//, "") : "" },
        };
      });
    });

    return parseDevToArticles(domArticles).slice(0, input.limit);
  },
};
