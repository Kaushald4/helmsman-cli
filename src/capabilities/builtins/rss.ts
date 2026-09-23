import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { userAgentHeader } from "../../driver/browser.js";

export interface RssArticle {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string;
  author: string | null;
  source: string;
}

export const RSS_PRESETS: Record<string, { name: string; url: string; category?: string }> = {
  // General Tech
  techcrunch: { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "Tech" },
  theverge: { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Tech" },
  arstechnica: { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "Tech" },
  infoq: { name: "InfoQ", url: "https://feed.infoq.com/", category: "Engineering" },

  // AI / ML
  "huggingface-blog": { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", category: "AI" },
  deepmind: { name: "Google DeepMind", url: "https://deepmind.google/blog/feed", category: "AI" },
  "openai-news": { name: "OpenAI News", url: "https://openai.com/news/rss.xml", category: "AI" },
  "the-decoder": { name: "The Decoder", url: "https://the-decoder.com/feed/", category: "AI" },
  syncedreview: { name: "Synced Review", url: "https://syncedreview.com/feed/", category: "AI" },
  kdnuggets: { name: "KDnuggets", url: "https://www.kdnuggets.com/feed", category: "Data Science & AI" },
  towardsdatascience: { name: "Towards Data Science", url: "https://towardsdatascience.com/feed/", category: "Data Science & AI" },
  "nvidia-dev-blog": { name: "NVIDIA Developer Blog", url: "https://developer.nvidia.com/blog/feed", category: "AI & Graphics" },

  // General Dev & Web
  "github-blog": { name: "GitHub Blog", url: "https://github.blog/feed/", category: "Engineering" },
  "hn-frontpage": { name: "Hacker News Frontpage", url: "https://news.ycombinator.com/rss", category: "Community" },
  "stackoverflow-blog": { name: "Stack Overflow Blog", url: "https://stackoverflow.blog/feed/", category: "Engineering" },
  thenewstack: { name: "The New Stack", url: "https://thenewstack.io/feed", category: "Cloud & Dev" },
  smashingmagazine: { name: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", category: "Design & Dev" },
  "css-tricks": { name: "CSS-Tricks", url: "https://css-tricks.com/feed/", category: "Web Dev" },
  freecodecamp: { name: "freeCodeCamp", url: "https://www.freecodecamp.org/news/rss/", category: "Web Dev" },
  sitepoint: { name: "SitePoint", url: "https://www.sitepoint.com/sitepoint.rss", category: "Web Dev" },
};

/**
 * Decodes XML entities including named and decimal/hexadecimal character references.
 */
export function decodeXmlEntities(text: string): string {
  if (!text) return "";
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      } catch {
        return "";
      }
    });
}

/**
 * Strips HTML tags and normalizes whitespace.
 */
export function stripHtmlTags(html: string): string {
  if (!html) return "";
  const cleaned = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeXmlEntities(cleaned);
}

/**
 * Extracts the inner text of an XML tag, handling CDATA blocks and entity encoding.
 */
function extractTagContent(xml: string, tag: string): string | null {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, "i");
  const match = xml.match(regex);
  if (!match || !match[1]) return null;
  return decodeXmlEntities(match[1]).trim();
}

/**
 * Extracts a link URL from an RSS/Atom element.
 * Supports <link>http...</link> as well as <link href="http..." rel="alternate" />.
 */
function extractLink(xml: string): string {
  // 1. Check for Atom-style <link href="..." />
  const linkMatches = xml.matchAll(/<(?:[a-zA-Z0-9_-]+:)?link(?:\s+[^>]*?)?(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?link>)/gi);
  let fallbackHref = "";

  for (const match of linkMatches) {
    const fullTag = match[0];
    const textContent = match[1]?.trim();

    // Check if there is an href attribute
    const hrefMatch = fullTag.match(/href=["']([^"']+)["']/i);
    const relMatch = fullTag.match(/rel=["']([^"']+)["']/i);

    if (hrefMatch && hrefMatch[1]) {
      const href = hrefMatch[1].trim();
      const rel = (relMatch && relMatch[1]) ? relMatch[1].toLowerCase() : "alternate";
      if (rel === "alternate" || !rel) {
        return href;
      }
      if (!fallbackHref) fallbackHref = href;
    } else if (textContent && !fallbackHref) {
      fallbackHref = decodeXmlEntities(textContent).trim();
    }
  }

  return fallbackHref;
}

/**
 * Universal RSS 2.0 & Atom feed parser.
 */
export function parseFeedXml(xml: string, defaultSource = "rss"): RssArticle[] {
  const articles: RssArticle[] = [];

  // Determine if it's Atom or RSS
  const isAtom = /<feed[\s>]/i.test(xml);
  const entryRegex = isAtom
    ? /<entry(?:\s+[^>]*)?>([\s\S]*?)<\/entry>/gi
    : /<item(?:\s+[^>]*)?>([\s\S]*?)<\/item>/gi;

  const matches = xml.matchAll(entryRegex);

  for (const match of matches) {
    const block = match[1];
    if (!block) continue;

    const rawTitle = extractTagContent(block, "title") || "";
    const title = stripHtmlTags(rawTitle);

    const link = extractLink(block);
    const guid = extractTagContent(block, "guid") || extractTagContent(block, "id") || link;

    const rawDate =
      extractTagContent(block, "pubDate") ||
      extractTagContent(block, "published") ||
      extractTagContent(block, "updated") ||
      "";

    const rawSummary =
      extractTagContent(block, "description") ||
      extractTagContent(block, "summary") ||
      extractTagContent(block, "content") ||
      "";

    const summary = rawSummary ? stripHtmlTags(rawSummary) : null;

    const author =
      extractTagContent(block, "creator") ||
      extractTagContent(block, "author") ||
      null;

    if (!title && !link) continue;

    articles.push({
      id: guid || link,
      title,
      url: link,
      summary,
      publishedAt: rawDate,
      author: author ? stripHtmlTags(author) : null,
      source: defaultSource,
    });
  }

  return articles;
}

export const rssFeedInputSchema = z.object({
  url: z
    .string()
    .min(1)
    .describe("RSS or Atom feed URL, or a built-in preset alias (e.g. 'techcrunch', 'deepmind', 'github-blog')"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of articles to extract"),
});

export type RssFeedInput = z.infer<typeof rssFeedInputSchema>;

export const rssFeedCapability: Capability<RssFeedInput, RssArticle[]> = {
  id: "rss.feed",
  name: "RSS / Atom Feed",
  description: "Extract articles from any RSS 2.0 or Atom feed, including 20 curated tech & AI presets.",
  riskLevel: "read",
  inputSchema: rssFeedInputSchema,

  async execute(ctx: ExecutionContext, input: RssFeedInput): Promise<RssArticle[]> {
    const rawTarget = input.url.trim().toLowerCase();
    const preset = RSS_PRESETS[rawTarget];
    const targetUrl = preset ? preset.url : input.url.trim();
    const sourceLabel = preset ? preset.name : targetUrl;

    let xml = "";

    // Attempt direct fetch first
    try {
      const res = await fetch(targetUrl, {
        headers: {
          ...userAgentHeader(),
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
      });
      if (res.ok) {
        xml = await res.text();
      }
    } catch {
      // If direct fetch fails, use the active browser page
    }

    // Fall back to browser page navigation if fetch failed or returned empty
    if (!xml && ctx.page) {
      const page = ctx.page;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      xml = await page.content();
    }

    if (!xml) {
      throw new Error(`Failed to retrieve RSS/Atom feed from ${targetUrl}`);
    }

    const items = parseFeedXml(xml, sourceLabel);
    return items.slice(0, input.limit);
  },
};
