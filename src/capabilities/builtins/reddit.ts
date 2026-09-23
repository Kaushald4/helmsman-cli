import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { scrollCollectDedupe, jitteredWait } from "../../driver/actions.js";

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  score: number;
  commentCount: number;
  permalink: string;
  postUrl: string;
  postType: string;
}

export const redditFeedInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of posts to extract"),
  subreddit: z.string().optional().describe("Optional subreddit name (e.g. 'technology' or 'r/technology')"),
  sort: z.enum(["hot", "new", "top"]).default("hot").describe("Sort order when viewing a subreddit"),
});

export type RedditFeedInput = z.infer<typeof redditFeedInputSchema>;

/**
 * Browser-injected function that scans the DOM for shreddit-post custom elements.
 */
function extractRedditPostsInPage(): RedditPost[] {
  const posts = Array.from(document.querySelectorAll("shreddit-post"));
  const results: RedditPost[] = [];

  for (const post of posts) {
    const permalink = post.getAttribute("permalink") || "";
    const title =
      post.getAttribute("post-title") ||
      post.querySelector("a[slot='title']")?.textContent?.trim() ||
      "";

    if (!title && !permalink) continue;

    const id = post.getAttribute("id") || permalink;
    const author = post.getAttribute("author") || "";
    const subreddit = post.getAttribute("subreddit-name") || "";
    const score = Number.parseInt(post.getAttribute("score") || "0", 10);
    const commentCount = Number.parseInt(post.getAttribute("comment-count") || "0", 10);
    const postType = post.getAttribute("post-type") || "text";
    const postUrl = permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;

    results.push({
      id,
      title,
      author,
      subreddit,
      score: Number.isNaN(score) ? 0 : score,
      commentCount: Number.isNaN(commentCount) ? 0 : commentCount,
      permalink,
      postUrl,
      postType,
    });
  }

  // Fallback: if shreddit-post not rendered, scan article or post containers
  if (results.length === 0) {
    const fallbackPosts = Array.from(document.querySelectorAll("article, [data-testid='post-container']"));
    for (const el of fallbackPosts) {
      const linkEl = el.querySelector<HTMLAnchorElement>("a[data-click-id='body'], a[data-testid='post-title'], a[href*='/comments/']");
      const permalink = linkEl?.getAttribute("href") || "";
      const title = el.querySelector("h1, h2, h3, [data-testid='post-title']")?.textContent?.trim() || "";
      if (!title && !permalink) continue;

      const author = el.querySelector("a[href*='/user/'], [data-testid='post_author']")?.textContent?.replace(/^u\//, "").trim() || "";
      const id = el.getAttribute("id") || permalink;
      const scoreEl = el.querySelector("[data-testid='vote-count'], [id*='vote-arrows']");
      const score = Number.parseInt(scoreEl?.textContent?.replace(/[^0-9-]/g, "") || "0", 10);
      const postUrl = permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;

      results.push({
        id,
        title,
        author,
        subreddit: "",
        score: Number.isNaN(score) ? 0 : score,
        commentCount: 0,
        permalink,
        postUrl,
        postType: "text",
      });
    }
  }

  return results;
}

/**
 * Parses raw Reddit JSON listing into structured RedditPost array.
 */
export function parseRedditJsonFeed(json: any): RedditPost[] {
  if (!json || !json.data || !Array.isArray(json.data.children)) return [];
  const results: RedditPost[] = [];
  for (const child of json.data.children) {
    const d = child?.data;
    if (!d || !d.title) continue;
    const permalink = d.permalink || "";
    results.push({
      id: d.id || permalink,
      title: d.title,
      author: d.author || "",
      subreddit: d.subreddit || "",
      score: typeof d.score === "number" ? d.score : 0,
      commentCount: typeof d.num_comments === "number" ? d.num_comments : 0,
      permalink,
      postUrl: d.url?.startsWith("http") ? d.url : `https://www.reddit.com${permalink}`,
      postType: d.post_hint || "text",
    });
  }
  return results;
}

/**
 * Injected check to detect if Reddit is presenting a blocking login interstitial.
 */
function isLoginWallActive(): boolean {
  const path = window.location.pathname;
  if (path.startsWith("/login") || path.startsWith("/register")) return true;
  return Boolean(document.querySelector("reddit-login-wall") || document.querySelector("xpromo-nsfw-blocking-modal"));
}

export const redditFeedCapability: Capability<RedditFeedInput, RedditPost[]> = {
  id: "reddit.feed",
  name: "Reddit Feed",
  description: "Extract posts from Reddit's home feed or a specific subreddit, including score, author, and comments count.",
  riskLevel: "read",
  inputSchema: redditFeedInputSchema,

  async execute(ctx: ExecutionContext, input: RedditFeedInput): Promise<RedditPost[]> {
    const page = ctx.page;

    let targetUrl = "https://www.reddit.com";
    if (input.subreddit) {
      const cleanSub = input.subreddit.replace(/^\/?r\//, "");
      targetUrl = `https://www.reddit.com/r/${cleanSub}/${input.sort ?? "hot"}`;
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await jitteredWait(500, 300);

    const isBlocked = await page.evaluate(isLoginWallActive);
    if (isBlocked) {
      throw new Error(
        `Reddit presented a login wall at ${targetUrl}. Re-authenticate the profile using 'helmsman auth login ${ctx.profileName} --site reddit.com'.`
      );
    }

    // Wait up to 8s for Reddit web components or post articles to mount
    await page.waitForSelector("shreddit-post, article, [data-testid='post-container']", {
      state: "attached",
      timeout: 8000,
    }).catch(() => {});

    // Scroll and accumulate distinct posts using virtualized list handler
    let posts = await scrollCollectDedupe<RedditPost>(
      page,
      extractRedditPostsInPage,
      (post) => post.permalink || post.id,
      {
        targetCount: input.limit,
        maxRounds: Math.ceil(input.limit / 5) + 3,
        jitterBaseMs: 400,
        jitterRangeMs: 300,
        consecutiveEmptyStops: 4,
      }
    );

    // Fallback: If DOM virtualizer yielded 0 posts (e.g. hydration delays in headless mode),
    // fetch Reddit's JSON feed within the authenticated browser page context
    if (posts.length === 0) {
      try {
        const jsonUrl = `${targetUrl.replace(/\/$/, "")}.json?limit=${input.limit}`;
        const jsonFeed = await page.evaluate(async (url) => {
          const res = await fetch(url, {
            headers: {
              Accept: "application/json",
            },
            credentials: "include",
          });
          if (!res.ok) return null;
          return await res.json();
        }, jsonUrl);

        if (jsonFeed) {
          posts = parseRedditJsonFeed(jsonFeed).slice(0, input.limit);
        }
      } catch {
        // Retain whatever posts were collected
      }
    }

    return posts;
  },
};
