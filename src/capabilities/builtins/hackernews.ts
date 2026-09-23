import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";

export interface HackerNewsStory {
  id: string;
  title: string;
  itemUrl: string;
  externalUrl: string | null;
  site: string | null;
  author: string;
  points: number;
  commentCount: number;
  publishedAt: string;
}

export interface HackerNewsStoryRaw {
  id: string | null;
  title: string | null;
  href: string | null;
  site: string | null;
  scoreText: string | null;
  author: string | null;
  ageTitle: string | null;
  commentsText: string | null;
  isJob: boolean;
}

function toInt(text: string | null): number {
  if (!text) return 0;
  const match = text.match(/\d[\d,]*/);
  if (!match) return 0;
  const n = Number.parseInt(match[0].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function parsePublishedAt(ageTitle: string | null): string {
  if (!ageTitle) return "";
  return ageTitle.split(" ")[0] ?? "";
}

export function parseHackerNewsStory(raw: HackerNewsStoryRaw): HackerNewsStory | null {
  const id = (raw.id ?? "").trim();
  const title = (raw.title ?? "").trim();
  if (!id || !title) return null;

  const href = raw.href ?? "";
  const isSelfLink = href.startsWith("item?id=") || href === "";
  const externalUrl = !isSelfLink ? href : null;

  return {
    id,
    title,
    itemUrl: `https://news.ycombinator.com/item?id=${id}`,
    externalUrl,
    site: (raw.site ?? "").trim() || null,
    author: (raw.author ?? "").trim(),
    points: toInt(raw.scoreText),
    commentCount: raw.commentsText === "discuss" ? 0 : toInt(raw.commentsText),
    publishedAt: parsePublishedAt(raw.ageTitle),
  };
}

/**
 * Injected script for extracting HN front-page story rows.
 */
function extractStoriesInPage(): { stories: HackerNewsStoryRaw[]; moreHref: string | null } {
  const rows = Array.from(document.querySelectorAll("tr.athing"));
  const stories: HackerNewsStoryRaw[] = rows.map((row) => {
    const titleline = row.querySelector(".titleline");
    const titleLink = titleline ? titleline.querySelector("a") : null;
    const site = titleline ? titleline.querySelector(".sitestr") : null;
    const subtextRow = row.nextElementSibling;
    const subtext = subtextRow ? subtextRow.querySelector(".subtext") : null;
    const score = subtext ? subtext.querySelector(".score") : null;
    const hnuser = subtext ? subtext.querySelector(".hnuser") : null;
    const age = subtext ? subtext.querySelector(".age") : null;
    const commentsLink = subtext
      ? Array.from(subtext.querySelectorAll("a")).find((a) => /comment|discuss/.test(a.textContent || ""))
      : null;

    return {
      id: row.id || null,
      title: titleLink ? (titleLink.textContent || "").trim() : null,
      href: titleLink ? titleLink.getAttribute("href") : null,
      site: site ? (site.textContent || "").trim() : null,
      scoreText: score ? (score.textContent || "").trim() : null,
      author: hnuser ? (hnuser.textContent || "").trim() : null,
      ageTitle: age ? age.getAttribute("title") : null,
      commentsText: commentsLink ? (commentsLink.textContent || "").trim() : null,
      isJob: row.classList.contains("job"),
    };
  });

  const moreLink = document.querySelector("a.morelink");
  const moreHref = moreLink ? moreLink.getAttribute("href") : null;

  return { stories, moreHref };
}

// ---------------------------------------------------------------------------
// HACKER NEWS FEED CAPABILITY
// ---------------------------------------------------------------------------
export const hackernewsFeedInputSchema = z.object({
  limit: z.number().int().min(1).max(90).default(30).describe("Number of stories to extract (up to 90)"),
});

export type HackerNewsFeedInput = z.infer<typeof hackernewsFeedInputSchema>;

export const hackernewsFeedCapability: Capability<HackerNewsFeedInput, HackerNewsStory[]> = {
  id: "hackernews.feed",
  name: "Hacker News Feed",
  description: "Extract stories from the front page of news.ycombinator.com with scores and discussion links.",
  riskLevel: "read",
  inputSchema: hackernewsFeedInputSchema,

  async execute(ctx: ExecutionContext, input: HackerNewsFeedInput): Promise<HackerNewsStory[]> {
    const page = ctx.page;
    const results: HackerNewsStory[] = [];
    let currentUrl: string | null = "https://news.ycombinator.com";

    while (currentUrl && results.length < input.limit) {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded" });
      const { stories, moreHref } = await page.evaluate(extractStoriesInPage);

      for (const raw of stories) {
        if (raw.isJob) continue; // Skip job rows
        const parsed = parseHackerNewsStory(raw);
        if (parsed) {
          results.push(parsed);
          if (results.length >= input.limit) break;
        }
      }

      if (results.length < input.limit && moreHref) {
        currentUrl = moreHref.startsWith("http") ? moreHref : `https://news.ycombinator.com/${moreHref}`;
      } else {
        currentUrl = null;
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------------------
// HACKER NEWS SEARCH CAPABILITY (Algolia API)
// ---------------------------------------------------------------------------
export const hackernewsSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query string"),
  sort: z.enum(["date", "points"]).default("date").describe("Sort order: 'date' (newest first) or 'points' (relevance/popularity)"),
  minPoints: z.number().int().min(0).optional().describe("Minimum number of points required"),
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of results to return"),
});

export type HackerNewsSearchInput = z.infer<typeof hackernewsSearchInputSchema>;

export const hackernewsSearchCapability: Capability<HackerNewsSearchInput, HackerNewsStory[]> = {
  id: "hackernews.search",
  name: "Hacker News Search",
  description: "Search Hacker News stories using the official Algolia search API.",
  riskLevel: "read",
  inputSchema: hackernewsSearchInputSchema,

  async execute(_ctx: ExecutionContext, input: HackerNewsSearchInput): Promise<HackerNewsStory[]> {
    const endpoint = input.sort === "date" ? "search_by_date" : "search";
    const params = new URLSearchParams({
      query: input.query,
      tags: "story",
      hitsPerPage: String(input.limit),
    });

    if (input.minPoints && input.minPoints > 0) {
      params.append("numericFilters", `points>=${input.minPoints}`);
    }

    const res = await fetch(`https://hn.algolia.com/api/v1/${endpoint}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Algolia HN search failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { hits: Array<{
      objectID: string;
      title: string | null;
      url?: string | null;
      author: string | null;
      points: number | null;
      num_comments: number | null;
      created_at: string;
    }> };

    return data.hits
      .filter((hit) => hit.objectID && hit.title)
      .map((hit) => ({
        id: hit.objectID,
        title: hit.title ?? "",
        itemUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        externalUrl: hit.url ?? null,
        site: hit.url ? new URL(hit.url).hostname.replace(/^www\./, "") : null,
        author: hit.author ?? "",
        points: hit.points ?? 0,
        commentCount: hit.num_comments ?? 0,
        publishedAt: hit.created_at,
      }));
  },
};
