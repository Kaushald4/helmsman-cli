import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { userAgentHeader } from "../../driver/browser.js";

export interface LobstersStory {
  id: string;
  title: string;
  url: string;
  body: string | null;
  author: string;
  authorUrl: string;
  score: number;
  commentCount: number;
  publishedAt: string;
  tags: string[];
}

export interface RawLobstersItem {
  short_id: string;
  short_id_url: string;
  created_at: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  description_plain?: string;
  submitter_user: string;
  tags?: string[];
}

/**
 * Parses Lobsters JSON items into structured LobstersStory models.
 */
export function parseLobstersJson(data: any): LobstersStory[] {
  if (!Array.isArray(data)) return [];
  const results: LobstersStory[] = [];

  for (const s of data) {
    if (!s || !s.short_id || !s.title) continue;
    const url = (s.url && s.url.trim()) ? s.url.trim() : s.short_id_url;

    results.push({
      id: s.short_id,
      title: s.title,
      url,
      body: s.description_plain ? s.description_plain.trim() : null,
      author: s.submitter_user || "anonymous",
      authorUrl: s.submitter_user ? `https://lobste.rs/~${s.submitter_user}` : "https://lobste.rs",
      score: typeof s.score === "number" ? s.score : 0,
      commentCount: typeof s.comment_count === "number" ? s.comment_count : 0,
      publishedAt: s.created_at || "",
      tags: Array.isArray(s.tags) ? s.tags : [],
    });
  }

  return results;
}

export const lobstersFeedInputSchema = z.object({
  sort: z.enum(["hottest", "newest"]).default("hottest").describe("Feed sort order: 'hottest' (default) or 'newest'"),
  limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of stories to extract (default 25)"),
});

export type LobstersFeedInput = z.infer<typeof lobstersFeedInputSchema>;

export const lobstersFeedCapability: Capability<LobstersFeedInput, LobstersStory[]> = {
  id: "lobsters.feed",
  name: "Lobsters Feed",
  description: "Extract stories and technical discussions from Lobste.rs front page or newest feed.",
  riskLevel: "read",
  inputSchema: lobstersFeedInputSchema,

  async execute(ctx: ExecutionContext, input: LobstersFeedInput): Promise<LobstersStory[]> {
    const sortPath = input.sort === "newest" ? "newest" : "hottest";
    const jsonUrl = `https://lobste.rs/${sortPath}.json`;

    // Attempt direct fetch first
    try {
      const res = await fetch(jsonUrl, {
        headers: {
          ...userAgentHeader(),
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = parseLobstersJson(data);
        if (parsed.length > 0) {
          return parsed.slice(0, input.limit);
        }
      }
    } catch {
      // Fall through to browser execution
    }

    // Fall back to browser page
    const page = ctx.page;
    await page.goto(`https://lobste.rs/${sortPath === "newest" ? "newest" : ""}`, { waitUntil: "domcontentloaded" });

    // Try fetching JSON within page context
    try {
      const pageJson = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        return await r.json();
      }, jsonUrl);

      if (pageJson) {
        const parsed = parseLobstersJson(pageJson);
        if (parsed.length > 0) {
          return parsed.slice(0, input.limit);
        }
      }
    } catch {
      // Scrape HTML DOM if JSON fetch in page fails
    }

    // Scrape DOM items from HTML
    const domStories = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("ol.stories > li.story"));
      return rows.map((row) => {
        const shortId = row.getAttribute("data-shortid") || "";
        const titleEl = row.querySelector("a.u-url");
        const title = titleEl?.textContent?.trim() || "";
        const url = titleEl?.getAttribute("href") || "";
        const scoreEl = row.querySelector(".score");
        const score = Number.parseInt(scoreEl?.textContent?.trim() || "0", 10);
        const authorEl = row.querySelector("a.u-author");
        const author = authorEl?.textContent?.trim() || "";
        const commentsEl = row.querySelector("span.comments_label a");
        const commentText = commentsEl?.textContent?.trim() || "";
        const commentMatch = commentText.match(/(\d+)/);
        const commentCount = (commentMatch && commentMatch[1]) ? Number.parseInt(commentMatch[1], 10) : 0;
        const tagEls = Array.from(row.querySelectorAll(".tags a.tag"));
        const tags = tagEls.map((t) => t.textContent?.trim() || "").filter(Boolean);

        return {
          short_id: shortId,
          short_id_url: `https://lobste.rs/s/${shortId}`,
          created_at: new Date().toISOString(),
          title,
          url,
          score: Number.isNaN(score) ? 0 : score,
          comment_count: commentCount,
          submitter_user: author,
          tags,
        };
      });
    });

    return parseLobstersJson(domStories).slice(0, input.limit);
  },
};
