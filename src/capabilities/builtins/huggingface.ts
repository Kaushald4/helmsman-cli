import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { jitteredWait } from "../../driver/actions.js";
import { userAgentHeader } from "../../driver/browser.js";

export interface HuggingFacePost {
  url: string;
  title: string;
  author: string;
  authorUrl: string;
  publishedAt: string;
  reactionCount: number;
}

export interface CommunityPostRaw {
  href: string | null;
  title: string | null;
  publishedAt: string | null;
  reactionCount: string | null;
}

export function parseCommunityPost(raw: CommunityPostRaw): HuggingFacePost | null {
  const href = raw.href ?? "";
  const title = (raw.title ?? "").trim();
  if (!href || !title) return null;

  const pathMatch = href.match(/^\/blog\/([^/]+)\//);
  const author = pathMatch && pathMatch[1] ? pathMatch[1] : "";

  const reactionNum = Number(raw.reactionCount);

  return {
    url: href.startsWith("http") ? href : `https://huggingface.co${href}`,
    title,
    author,
    authorUrl: author ? `https://huggingface.co/${author}` : "",
    publishedAt: (raw.publishedAt ?? "").trim(),
    reactionCount: Number.isFinite(reactionNum) ? reactionNum : 0,
  };
}

function extractCommunityPostsInPage(): CommunityPostRaw[] {
  const articles = Array.from(document.querySelectorAll("article"));
  return articles.map((article) => {
    const anchor = article.querySelector("a[href]");
    const h4 = article.querySelector("h4");
    const time = article.querySelector("time[datetime]");
    const fullText = anchor ? anchor.textContent || "" : "";
    const reactionMatch = fullText.match(/(\d+)\s*$/);

    return {
      href: anchor ? anchor.getAttribute("href") : null,
      title: h4 ? (h4.textContent || "").trim() : null,
      publishedAt: time ? time.getAttribute("datetime") : null,
      reactionCount: reactionMatch ? reactionMatch[1] ?? null : null,
    };
  });
}

// ---------------------------------------------------------------------------
// HUGGING FACE COMMUNITY CAPABILITY
// ---------------------------------------------------------------------------
export const huggingfaceCommunityInputSchema = z.object({
  sort: z.enum(["trending", "recent"]).default("trending").describe("Sort order: 'trending' or 'recent'"),
  limit: z.number().int().min(1).max(30).default(15).describe("Maximum number of posts to return"),
});

export type HuggingFaceCommunityInput = z.infer<typeof huggingfaceCommunityInputSchema>;

export const huggingfaceCommunityCapability: Capability<HuggingFaceCommunityInput, HuggingFacePost[]> = {
  id: "huggingface.community",
  name: "Hugging Face Community Posts",
  description: "Extract community blog posts and technical discussions from Hugging Face.",
  riskLevel: "read",
  inputSchema: huggingfaceCommunityInputSchema,

  async execute(ctx: ExecutionContext, input: HuggingFaceCommunityInput): Promise<HuggingFacePost[]> {
    const page = ctx.page;
    const url = `https://huggingface.co/blog/community?sort=${input.sort}`;

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await jitteredWait(500, 300);

    const rawPosts = await page.evaluate(extractCommunityPostsInPage);
    const posts = rawPosts
      .map(parseCommunityPost)
      .filter((p): p is HuggingFacePost => p !== null);

    return posts.slice(0, input.limit);
  },
};

// ---------------------------------------------------------------------------
// HUGGING FACE PAPERS CAPABILITY (Daily Papers)
// ---------------------------------------------------------------------------
export interface HuggingFacePaper {
  id: string;
  title: string;
  summary: string;
  url: string;
  authors: string[];
  upvotes: number;
  commentCount: number;
  publishedAt: string;
}

export function parseHuggingFacePapers(data: any): HuggingFacePaper[] {
  if (!Array.isArray(data)) return [];
  const papers: HuggingFacePaper[] = [];

  for (const item of data) {
    if (!item) continue;
    const paper = item.paper || item;
    const id = paper.id || "";
    const title = item.title || paper.title || "";
    if (!id && !title) continue;

    const authors = Array.isArray(paper.authors)
      ? paper.authors.map((a: any) => (typeof a === "string" ? a : a.name || "")).filter(Boolean)
      : [];

    const summary = (item.summary || paper.summary || "").replace(/\s+/g, " ").trim();
    const upvotes = typeof paper.upvotes === "number" ? paper.upvotes : (typeof item.upvotes === "number" ? item.upvotes : 0);
    const commentCount = typeof item.numComments === "number" ? item.numComments : 0;
    const publishedAt = item.publishedAt || paper.publishedAt || "";

    papers.push({
      id,
      title: title.trim(),
      summary,
      url: `https://huggingface.co/papers/${id}`,
      authors,
      upvotes,
      commentCount,
      publishedAt,
    });
  }

  return papers;
}

export const huggingfacePapersInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of papers to return (default 20)"),
});

export type HuggingFacePapersInput = z.infer<typeof huggingfacePapersInputSchema>;

export const huggingfacePapersCapability: Capability<HuggingFacePapersInput, HuggingFacePaper[]> = {
  id: "huggingface.papers",
  name: "Hugging Face Daily Papers",
  description: "Extract trending daily AI research papers from Hugging Face Papers leaderboard.",
  riskLevel: "read",
  inputSchema: huggingfacePapersInputSchema,

  async execute(ctx: ExecutionContext, input: HuggingFacePapersInput): Promise<HuggingFacePaper[]> {
    const apiUrl = "https://huggingface.co/api/daily_papers";

    // Direct HTTP fetch first
    try {
      const res = await fetch(apiUrl, {
        headers: {
          ...userAgentHeader(),
          Accept: "application/json",
        },
      });

      if (res.ok) {
        const json = await res.json();
        const papers = parseHuggingFacePapers(json);
        if (papers.length > 0) {
          return papers.slice(0, input.limit);
        }
      }
    } catch {
      // Fall through to browser execution
    }

    // In-browser execution fallback
    const page = ctx.page;
    await page.goto("https://huggingface.co/papers", { waitUntil: "domcontentloaded" });
    await jitteredWait(500, 300);

    // Fetch API within browser context
    try {
      const browserJson = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) return null;
        return await r.json();
      }, apiUrl);

      if (browserJson) {
        const parsed = parseHuggingFacePapers(browserJson);
        if (parsed.length > 0) {
          return parsed.slice(0, input.limit);
        }
      }
    } catch {
      // Scrape DOM fallback
    }

    // Fallback: Scrape paper articles from HTML DOM
    const domPapers = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll("article"));
      return articles.map((art) => {
        const link = art.querySelector<HTMLAnchorElement>("a[href*='/papers/']");
        const titleEl = art.querySelector("h3, h4, a[href*='/papers/']");
        const upvoteEl = art.querySelector("[class*='vote'], [class*='like']");
        const href = link?.getAttribute("href") || "";
        const idMatch = href.match(/\/papers\/([0-9.]+)/);
        const id = idMatch ? idMatch[1] : href;

        const upvoteText = upvoteEl?.textContent?.trim() || "0";
        const upvotes = Number.parseInt(upvoteText.replace(/[^0-9]/g, "") || "0", 10);

        return {
          paper: {
            id,
            upvotes: Number.isNaN(upvotes) ? 0 : upvotes,
          },
          title: titleEl?.textContent?.trim() || "",
          summary: "",
          publishedAt: new Date().toISOString(),
          numComments: 0,
        };
      });
    });

    return parseHuggingFacePapers(domPapers).slice(0, input.limit);
  },
};
