import { z } from "zod";
import type { Capability, ExecutionContext } from "../types.js";
import { decodeXmlEntities, stripHtmlTags } from "./rss.js";
import { userAgentHeader } from "../../driver/browser.js";

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  url: string;
  pdfUrl: string | null;
  authors: string[];
  category: string;
  publishedAt: string;
  updatedAt: string;
}

/**
 * Parses arXiv Atom API feed XML into structured ArxivPaper objects.
 */
export function parseArxivAtom(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entryRegex = /<entry(?:\s+[^>]*)?>([\s\S]*?)<\/entry>/gi;
  const matches = xml.matchAll(entryRegex);

  for (const match of matches) {
    const block = match[1];
    if (!block) continue;

    // ID
    const idMatch = block.match(/<id>([\s\S]*?)<\/id>/i);
    const rawId = (idMatch && idMatch[1]) ? idMatch[1].trim() : "";
    const id = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, "");

    // Title
    const titleMatch = block.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i);
    const rawTitle = (titleMatch && titleMatch[1]) ? decodeXmlEntities(titleMatch[1]) : "";
    const title = rawTitle.replace(/\s+/g, " ").trim();

    // Summary
    const summaryMatch = block.match(/<summary(?:\s+[^>]*)?>([\s\S]*?)<\/summary>/i);
    const rawSummary = (summaryMatch && summaryMatch[1]) ? decodeXmlEntities(summaryMatch[1]) : "";
    const summary = rawSummary.replace(/\s+/g, " ").trim();

    // URL & PDF link
    let url = rawId;
    let pdfUrl: string | null = null;
    const linkMatches = block.matchAll(/<link(?:\s+[^>]*?)(?:\/>|>[\s\S]*?<\/link>)/gi);
    for (const lm of linkMatches) {
      const tag = lm[0];
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      const titleMatch = tag.match(/title=["']([^"']+)["']/i);
      const relMatch = tag.match(/rel=["']([^"']+)["']/i);

      if (hrefMatch && hrefMatch[1]) {
        const href = hrefMatch[1].trim();
        if (titleMatch && titleMatch[1]?.toLowerCase() === "pdf") {
          pdfUrl = href;
        } else if (relMatch && relMatch[1]?.toLowerCase() === "alternate") {
          url = href;
        } else if (!url) {
          url = href;
        }
      }
    }

    // Authors
    const authors: string[] = [];
    const authorMatches = block.matchAll(/<author>([\s\S]*?)<\/author>/gi);
    for (const am of authorMatches) {
      const authorBlock = am[1];
      if (!authorBlock) continue;
      const nameMatch = authorBlock.match(/<name>([\s\S]*?)<\/name>/i);
      if (nameMatch && nameMatch[1]) {
        const name = stripHtmlTags(decodeXmlEntities(nameMatch[1]));
        if (name) authors.push(name);
      }
    }

    // Primary Category
    const catMatch = block.match(/<arxiv:primary_category(?:\s+[^>]*?)term=["']([^"']+)["']/i)
      || block.match(/<category(?:\s+[^>]*?)term=["']([^"']+)["']/i);
    const category = (catMatch && catMatch[1]) ? catMatch[1].trim() : "";

    // Dates
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/i);
    const updatedMatch = block.match(/<updated>([\s\S]*?)<\/updated>/i);
    const publishedAt = (publishedMatch && publishedMatch[1]) ? publishedMatch[1].trim() : "";
    const updatedAt = (updatedMatch && updatedMatch[1]) ? updatedMatch[1].trim() : publishedAt;

    if (!title && !url) continue;

    papers.push({
      id: id || url,
      title,
      summary,
      url,
      pdfUrl,
      authors,
      category,
      publishedAt,
      updatedAt,
    });
  }

  return papers;
}

export const arxivPapersInputSchema = z.object({
  category: z
    .string()
    .default("cs.AI")
    .describe("arXiv category (e.g. 'cs.AI', 'cs.CL', 'cs.LG', 'cs.CV', 'stat.ML')"),
  query: z.string().optional().describe("Optional search query (e.g. 'transformer', 'agent', 'reasoning')"),
  sortBy: z
    .enum(["submittedDate", "lastUpdatedDate", "relevance"])
    .default("submittedDate")
    .describe("Sort field: 'submittedDate' (newest first), 'lastUpdatedDate', or 'relevance'"),
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of papers to return (default 20)"),
});

export type ArxivPapersInput = z.infer<typeof arxivPapersInputSchema>;

export const arxivPapersCapability: Capability<ArxivPapersInput, ArxivPaper[]> = {
  id: "arxiv.papers",
  name: "arXiv Papers",
  description: "Extract scientific research papers from arXiv across computer science, AI, and related disciplines.",
  riskLevel: "read",
  inputSchema: arxivPapersInputSchema,

  async execute(ctx: ExecutionContext, input: ArxivPapersInput): Promise<ArxivPaper[]> {
    let searchQuery = `cat:${input.category}`;
    if (input.query && input.query.trim()) {
      searchQuery = `cat:${input.category} AND all:${input.query.trim()}`;
    }

    const apiUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(
      searchQuery
    )}&sortBy=${input.sortBy}&sortOrder=descending&max_results=${input.limit}`;

    let xml = "";

    // Attempt direct fetch first
    try {
      const res = await fetch(apiUrl, {
        headers: {
          ...userAgentHeader(),
          Accept: "application/atom+xml, application/xml, text/xml",
        },
      });

      if (res.ok) {
        xml = await res.text();
      }
    } catch {
      // Fall through to browser page
    }

    // Fall back to browser page navigation
    if (!xml && ctx.page) {
      const page = ctx.page;
      await page.goto(apiUrl, { waitUntil: "domcontentloaded" });
      xml = await page.content();
    }

    if (!xml) {
      throw new Error(`Failed to retrieve arXiv Atom feed from ${apiUrl}`);
    }

    const papers = parseArxivAtom(xml);
    return papers.slice(0, input.limit);
  },
};
