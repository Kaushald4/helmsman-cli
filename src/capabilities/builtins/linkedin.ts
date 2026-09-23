import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { jitteredWait, scrollLikeAPersonWould } from "../../driver/actions.js";

export interface LinkedInJob {
  title: string;
  company: string;
  location: string;
  workplaceType: string;
  postedAt: string;
  badges: string[];
  jobUrl: string;
}

export interface LinkedInFeedPost {
  authorName: string;
  authorHeadline: string;
  postText: string;
  postedAt: string;
  postUrl: string;
}

const KNOWN_BADGES = /^(promoted|easy apply|actively hiring|actively recruiting|be an early applicant|viewed|applied|saved|verified job)$/i;

function cleanText(val: string): string {
  return val.replace(/\s+/g, " ").trim();
}

/**
 * In-browser job extraction script.
 */
function extractJobRawItemsInPage(): Array<{ innerText: string; hrefs: string[] }> {
  const JOB_WORDS =
    /engineer|developer|manager|analyst|designer|specialist|lead|architect|scientist|intern|consultant|director|coordinator|administrator/i;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node: Element | null = walker.currentNode as Element;
  const titleLeaves: Element[] = [];
  while (node) {
    if (node.children.length === 0) {
      const t = (node.textContent || "").trim();
      if (t.length > 3 && t.length < 100 && JOB_WORDS.test(t)) titleLeaves.push(node);
    }
    node = walker.nextNode() as Element | null;
  }

  const rootsByParent = new Map<Element, { root: Element; count: number }>();
  for (const leaf of titleLeaves) {
    let cur: Element | null = leaf;
    let depth = 0;
    while (cur && cur.parentElement && depth < 20) {
      const parent: Element = cur.parentElement;
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === (cur as Element).tagName);
      if (sameTag.length >= 6) {
        if (!rootsByParent.has(parent)) rootsByParent.set(parent, { root: cur, count: 0 });
        rootsByParent.get(parent)!.count++;
        break;
      }
      cur = parent;
      depth++;
    }
  }

  let bestParent: Element | null = null;
  let bestCount = 0;
  for (const [parent, { count }] of rootsByParent) {
    if (count > bestCount) {
      bestParent = parent;
      bestCount = count;
    }
  }
  if (!bestParent) return [];

  const winningTag = rootsByParent.get(bestParent)!.root.tagName;
  const items = Array.from(bestParent.children).filter((c) => c.tagName === winningTag);
  return items.map((el) => {
    const hrefs = Array.from(el.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);
    const keyedEl = el.querySelector("[componentkey]");
    const componentKey = keyedEl?.getAttribute("componentkey") ?? "";
    const idMatch = componentKey.match(/job-card-component-ref-(\d+)/);
    if (idMatch && idMatch[1]) hrefs.push(`https://www.linkedin.com/jobs/view/${idMatch[1]}/`);
    return { innerText: (el as HTMLElement).innerText || "", hrefs };
  });
}

export function parseJobCard(raw: { innerText: string; hrefs: string[] }): LinkedInJob | null {
  const blocks = raw.innerText
    .split(/\n\s*\n/)
    .map(cleanText)
    .filter(Boolean);

  if (blocks.length < 2) return null;

  const rawTitle = blocks[0] ?? "";
  const title = rawTitle.replace(/\(verified job\)/gi, "").trim();
  const company = blocks[1] ?? "";

  let location = "";
  let workplaceType = "";
  let postedAt = "";
  const badges: string[] = [];

  for (let i = 2; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (KNOWN_BADGES.test(block)) {
      badges.push(block);
    } else if (!location && !block.includes("ago")) {
      const match = block.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (match && match[1] && match[2]) {
        location = cleanText(match[1]);
        workplaceType = cleanText(match[2]);
      } else {
        location = block;
      }
    } else if (block.includes("ago")) {
      postedAt = block;
    }
  }

  const jobUrl = raw.hrefs.find((h) => h.includes("/jobs/view/")) || raw.hrefs[0] || "";

  return {
    title,
    company,
    location,
    workplaceType,
    postedAt,
    badges,
    jobUrl,
  };
}

function isLinkedInLoginWall(): boolean {
  const path = window.location.pathname;
  return path.includes("/login") || path.includes("/checkpoint") || Boolean(document.querySelector(".authwall-join-form"));
}

// ---------------------------------------------------------------------------
// LINKEDIN JOBS CAPABILITY
// ---------------------------------------------------------------------------
export const linkedinJobsInputSchema = z.object({
  keywords: z.string().min(1).describe("Job title or search keywords"),
  location: z.string().optional().describe("Geographic location (e.g. 'United States', 'San Francisco', 'Remote')"),
  limit: z.number().int().min(1).max(50).default(15).describe("Maximum number of jobs to return"),
});

export type LinkedInJobsInput = z.infer<typeof linkedinJobsInputSchema>;

export const linkedinJobsCapability: Capability<LinkedInJobsInput, LinkedInJob[]> = {
  id: "linkedin.jobs",
  name: "LinkedIn Jobs",
  description: "Search and extract job listings from LinkedIn with title, company, location, and application URLs.",
  riskLevel: "read",
  inputSchema: linkedinJobsInputSchema,

  async execute(ctx: ExecutionContext, input: LinkedInJobsInput): Promise<LinkedInJob[]> {
    const page = ctx.page;
    let url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(input.keywords)}`;
    if (input.location) {
      url += `&location=${encodeURIComponent(input.location)}`;
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await jitteredWait(700, 400);

    if (await page.evaluate(isLinkedInLoginWall)) {
      throw new Error(
        `LinkedIn requires authentication. Please log in using 'helmsman auth login ${ctx.profileName} --site linkedin.com'.`
      );
    }

    // Scroll to trigger lazy loading
    await scrollLikeAPersonWould(page, 4);
    await jitteredWait(500, 300);

    const rawItems = await page.evaluate(extractJobRawItemsInPage);
    const jobs = rawItems
      .map(parseJobCard)
      .filter((j): j is LinkedInJob => j !== null && Boolean(j.title && j.company));

    return jobs.slice(0, input.limit);
  },
};

// ---------------------------------------------------------------------------
// LINKEDIN FEED CAPABILITY
// ---------------------------------------------------------------------------
export const linkedinFeedInputSchema = z.object({
  limit: z.number().int().min(1).max(25).default(10).describe("Maximum number of feed posts to return"),
});

export type LinkedInFeedInput = z.infer<typeof linkedinFeedInputSchema>;

export const linkedinFeedCapability: Capability<LinkedInFeedInput, LinkedInFeedPost[]> = {
  id: "linkedin.feed",
  name: "LinkedIn Feed",
  description: "Extract posts from the authenticated LinkedIn home feed.",
  riskLevel: "read",
  inputSchema: linkedinFeedInputSchema,

  async execute(ctx: ExecutionContext, input: LinkedInFeedInput): Promise<LinkedInFeedPost[]> {
    const page = ctx.page;
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    await jitteredWait(800, 400);

    if (await page.evaluate(isLinkedInLoginWall)) {
      throw new Error(
        `LinkedIn requires authentication. Please log in using 'helmsman auth login ${ctx.profileName} --site linkedin.com'.`
      );
    }

    await scrollLikeAPersonWould(page, 3);
    await jitteredWait(500, 300);

    const rawItems = await page.evaluate(() => {
      const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));
      return listItems.map((el) => {
        const text = (el as HTMLElement).innerText || "";
        const links = Array.from(el.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);
        return { text, links };
      });
    });

    const posts: LinkedInFeedPost[] = [];
    for (const item of rawItems) {
      if (!item.text.includes("Feed post") && !item.text.includes("ago")) continue;
      const lines = item.text.split("\n").map(cleanText).filter(Boolean);
      if (lines.length < 3) continue;

      const authorName = lines[0] || "";
      const authorHeadline = lines[1] || "";
      const postText = lines.slice(2, 6).join(" ");
      const postUrl = item.links.find((l) => l.includes("/feed/update/urn:li:activity:")) || item.links[0] || "";

      posts.push({
        authorName,
        authorHeadline,
        postText,
        postedAt: lines.find((l) => l.includes("ago")) || "",
        postUrl,
      });

      if (posts.length >= input.limit) break;
    }

    return posts;
  },
};
