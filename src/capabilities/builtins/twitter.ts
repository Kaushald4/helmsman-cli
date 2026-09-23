import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { scrollCollectDedupe, jitteredWait } from "../../driver/actions.js";

export interface TwitterTweetRaw {
  statusHref: string | null;
  authorName: string | null;
  verified: boolean;
  timeDatetime: string | null;
  tweetText: string | null;
  groupAriaLabel: string | null;
  photoUrls: string[];
  isRepost: boolean;
  repostedBy: string | null;
}

export interface Tweet {
  handle: string;
  authorName: string;
  verified: boolean;
  text: string;
  statusUrl: string;
  publishedAt: string;
  replies: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  photoUrls: string[];
  isRepost: boolean;
  repostedBy: string | null;
}

export function parseCount(label: string | null, pattern: RegExp): number {
  if (!label) return 0;
  const match = label.match(pattern);
  if (!match || !match[1]) return 0;
  const n = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseTweet(raw: TwitterTweetRaw): Tweet | null {
  const statusHref = raw.statusHref ?? "";
  const handleMatch = statusHref.match(/^\/([^/]+)\/status\//);
  const handle = handleMatch && handleMatch[1] ? handleMatch[1] : "";
  if (!handle) return null;

  const text = (raw.tweetText ?? "").trim();
  if (!text && raw.photoUrls.length === 0) return null;

  return {
    handle,
    authorName: (raw.authorName ?? "").trim(),
    verified: raw.verified,
    text,
    statusUrl: `https://x.com${statusHref}`,
    publishedAt: (raw.timeDatetime ?? "").trim(),
    replies: parseCount(raw.groupAriaLabel, /(\d[\d,]*)\s+repl(?:y|ies)/i),
    reposts: parseCount(raw.groupAriaLabel, /(\d[\d,]*)\s+reposts?/i),
    likes: parseCount(raw.groupAriaLabel, /(\d[\d,]*)\s+likes?/i),
    bookmarks: parseCount(raw.groupAriaLabel, /(\d[\d,]*)\s+bookmarks?/i),
    views: parseCount(raw.groupAriaLabel, /(\d[\d,]*)\s+views?/i),
    photoUrls: raw.photoUrls,
    isRepost: raw.isRepost,
    repostedBy: raw.repostedBy,
  };
}

/**
 * In-browser extractor: scans visible <article data-testid="tweet"> elements.
 */
function extractTweetsInPage(): TwitterTweetRaw[] {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  return articles.map((el) => {
    const statusLink = el.querySelector('a[href*="/status/"]');
    const timeEl = el.querySelector("time");
    const userNameBlock = el.querySelector('[data-testid="User-Name"]');
    const firstLink = userNameBlock ? userNameBlock.querySelector('a[href^="/"]') : null;
    const tweetTextEl = el.querySelector('[data-testid="tweetText"]');
    const group = el.querySelector('[role="group"]');
    const photoImgs = Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img'));
    const socialContext = el.querySelector('[data-testid="socialContext"]');
    const verified = Boolean(userNameBlock && userNameBlock.querySelector('[data-testid="icon-verified"]'));

    return {
      statusHref: statusLink ? statusLink.getAttribute("href") : null,
      authorName: firstLink ? (firstLink.textContent || "").trim() : null,
      verified,
      timeDatetime: timeEl ? timeEl.getAttribute("datetime") : null,
      tweetText: tweetTextEl ? (tweetTextEl.textContent || "").trim() : null,
      groupAriaLabel: group ? group.getAttribute("aria-label") : null,
      photoUrls: photoImgs.map((img) => img.getAttribute("src") || "").filter(Boolean),
      isRepost: Boolean(socialContext),
      repostedBy: socialContext ? (socialContext.textContent || "").trim() : null,
    };
  });
}

function isTwitterLoginWall(): boolean {
  const path = window.location.pathname;
  return path.includes("/login") || path.includes("/i/flow/login");
}

// ---------------------------------------------------------------------------
// TWITTER FEED CAPABILITY
// ---------------------------------------------------------------------------
export const twitterFeedInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of tweets to collect"),
});

export type TwitterFeedInput = z.infer<typeof twitterFeedInputSchema>;

export const twitterFeedCapability: Capability<TwitterFeedInput, Tweet[]> = {
  id: "twitter.feed",
  name: "Twitter Feed",
  description: "Extract tweets from the authenticated X/Twitter home timeline with engagement metrics.",
  riskLevel: "read",
  inputSchema: twitterFeedInputSchema,

  async execute(ctx: ExecutionContext, input: TwitterFeedInput): Promise<Tweet[]> {
    const page = ctx.page;
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    await jitteredWait(600, 300);

    if (await page.evaluate(isTwitterLoginWall)) {
      throw new Error(
        `X/Twitter requires authentication. Please log in using 'helmsman auth login ${ctx.profileName} --site x.com'.`
      );
    }

    const rawTweets = await scrollCollectDedupe<TwitterTweetRaw>(
      page,
      extractTweetsInPage,
      (t) => t.statusHref || "",
      {
        targetCount: input.limit,
        maxRounds: Math.ceil(input.limit / 4) + 4,
        jitterBaseMs: 500,
        jitterRangeMs: 400,
      }
    );

    return rawTweets.map(parseTweet).filter((t): t is Tweet => t !== null);
  },
};

// ---------------------------------------------------------------------------
// TWITTER SEARCH CAPABILITY
// ---------------------------------------------------------------------------
export const twitterSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query string"),
  sort: z.enum(["top", "latest"]).default("top").describe("Sort order: 'top' (default) or 'latest'"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of tweets to return"),
});

export type TwitterSearchInput = z.infer<typeof twitterSearchInputSchema>;

export const twitterSearchCapability: Capability<TwitterSearchInput, Tweet[]> = {
  id: "twitter.search",
  name: "Twitter Search",
  description: "Search tweets on X/Twitter by query with engagement counts.",
  riskLevel: "read",
  inputSchema: twitterSearchInputSchema,

  async execute(ctx: ExecutionContext, input: TwitterSearchInput): Promise<Tweet[]> {
    const page = ctx.page;
    const filterParam = input.sort === "latest" ? "&f=live" : "";
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(input.query)}${filterParam}`;

    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await jitteredWait(600, 300);

    if (await page.evaluate(isTwitterLoginWall)) {
      throw new Error(
        `X/Twitter requires authentication. Please log in using 'helmsman auth login ${ctx.profileName} --site x.com'.`
      );
    }

    const rawTweets = await scrollCollectDedupe<TwitterTweetRaw>(
      page,
      extractTweetsInPage,
      (t) => t.statusHref || "",
      {
        targetCount: input.limit,
        maxRounds: Math.ceil(input.limit / 4) + 4,
        jitterBaseMs: 500,
        jitterRangeMs: 400,
      }
    );

    return rawTweets.map(parseTweet).filter((t): t is Tweet => t !== null);
  },
};
