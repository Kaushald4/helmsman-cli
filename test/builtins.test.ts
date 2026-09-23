import { describe, it, expect } from "vitest";
import { defaultRegistry } from "../src/capabilities/registry.js";
import { registerBuiltins } from "../src/capabilities/builtins/index.js";
import { parseTweet, twitterFeedInputSchema, twitterSearchInputSchema } from "../src/capabilities/builtins/twitter.js";
import { parseHackerNewsStory, hackernewsFeedInputSchema, hackernewsSearchInputSchema } from "../src/capabilities/builtins/hackernews.js";
import { parseJobCard, linkedinJobsInputSchema } from "../src/capabilities/builtins/linkedin.js";
import { parseCommunityPost, parseHuggingFacePapers, huggingfaceCommunityInputSchema, huggingfacePapersInputSchema } from "../src/capabilities/builtins/huggingface.js";
import { parseRedditJsonFeed, redditFeedInputSchema } from "../src/capabilities/builtins/reddit.js";
import { parseLobstersJson, lobstersFeedInputSchema } from "../src/capabilities/builtins/lobsters.js";
import { parseDevToArticles, devtoArticlesInputSchema } from "../src/capabilities/builtins/devto.js";
import { parseProductHuntGraphQL, producthuntFeedInputSchema } from "../src/capabilities/builtins/producthunt.js";
import { parseArxivAtom, arxivPapersInputSchema } from "../src/capabilities/builtins/arxiv.js";
import { parseFeedXml, decodeXmlEntities, stripHtmlTags, RSS_PRESETS, rssFeedInputSchema } from "../src/capabilities/builtins/rss.js";

describe("Builtin Capabilities Registration", () => {
  it("should register all 14 platform extractors in the registry", () => {
    registerBuiltins();
    const list = defaultRegistry.list();
    const ids = list.map((c) => c.id);

    expect(ids).toContain("reddit.feed");
    expect(ids).toContain("twitter.feed");
    expect(ids).toContain("twitter.search");
    expect(ids).toContain("hackernews.feed");
    expect(ids).toContain("hackernews.search");
    expect(ids).toContain("linkedin.jobs");
    expect(ids).toContain("linkedin.feed");
    expect(ids).toContain("huggingface.community");
    expect(ids).toContain("huggingface.papers");
    expect(ids).toContain("lobsters.feed");
    expect(ids).toContain("devto.articles");
    expect(ids).toContain("producthunt.feed");
    expect(ids).toContain("arxiv.papers");
    expect(ids).toContain("rss.feed");
    expect(list.length).toBeGreaterThanOrEqual(14);
  });
});

describe("Twitter Parsing & Schemas", () => {
  it("should parse tweet with metrics from aria-label", () => {
    const tweet = parseTweet({
      statusHref: "/jack/status/20",
      authorName: "Jack Dorsey",
      verified: true,
      timeDatetime: "2006-03-21T20:50:00.000Z",
      tweetText: "just setting up my twttr",
      groupAriaLabel: "15,230 replies, 84,100 reposts, 140,500 likes, 12,000 bookmarks, 10,000,000 views",
      photoUrls: [],
      isRepost: false,
      repostedBy: null,
    });

    expect(tweet).toBeDefined();
    expect(tweet?.handle).toBe("jack");
    expect(tweet?.authorName).toBe("Jack Dorsey");
    expect(tweet?.replies).toBe(15230);
    expect(tweet?.reposts).toBe(84100);
    expect(tweet?.likes).toBe(140500);
    expect(tweet?.views).toBe(10000000);
    expect(tweet?.statusUrl).toBe("https://x.com/jack/status/20");
  });

  it("should validate twitter search input schema", () => {
    const input = twitterSearchInputSchema.parse({ query: "artificial intelligence" });
    expect(input.query).toBe("artificial intelligence");
    expect(input.sort).toBe("top");
    expect(input.limit).toBe(20);
  });
});

describe("Hacker News Parsing & Schemas", () => {
  it("should parse front page story row", () => {
    const story = parseHackerNewsStory({
      id: "40001234",
      title: "Show HN: Helmsman – Agent-first browser runtime",
      href: "https://github.com/my-tech-journal/helmsman",
      site: "github.com",
      scoreText: "350 points",
      author: "kaushal",
      ageTitle: "2026-09-19T07:30:00 1789800000",
      commentsText: "120 comments",
      isJob: false,
    });

    expect(story).toBeDefined();
    expect(story?.id).toBe("40001234");
    expect(story?.title).toBe("Show HN: Helmsman – Agent-first browser runtime");
    expect(story?.points).toBe(350);
    expect(story?.commentCount).toBe(120);
    expect(story?.site).toBe("github.com");
    expect(story?.publishedAt).toBe("2026-09-19T07:30:00");
  });

  it("should validate HN feed input schema defaults", () => {
    const input = hackernewsFeedInputSchema.parse({});
    expect(input.limit).toBe(30);
  });
});

describe("LinkedIn Parsing & Schemas", () => {
  it("should parse job card with company, location and badges", () => {
    const job = parseJobCard({
      innerText: "Senior Staff Engineer (Verified job)\n\nGoogle\n\nMountain View, CA (Hybrid)\n\nPosted 2 days ago\n\nEasy Apply\n\nActively recruiting",
      hrefs: ["https://www.linkedin.com/jobs/view/999888/"],
    });

    expect(job).toBeDefined();
    expect(job?.title).toBe("Senior Staff Engineer");
    expect(job?.company).toBe("Google");
    expect(job?.location).toBe("Mountain View, CA");
    expect(job?.workplaceType).toBe("Hybrid");
    expect(job?.badges).toContain("Easy Apply");
    expect(job?.jobUrl).toBe("https://www.linkedin.com/jobs/view/999888/");
  });

  it("should validate linkedin jobs input schema", () => {
    const input = linkedinJobsInputSchema.parse({ keywords: "AI Engineer", location: "San Francisco" });
    expect(input.keywords).toBe("AI Engineer");
    expect(input.location).toBe("San Francisco");
    expect(input.limit).toBe(15);
  });
});

describe("Hugging Face Parsing & Schemas", () => {
  it("should parse community post and extract author from path", () => {
    const post = parseCommunityPost({
      href: "/blog/deepmind/agents-overview",
      title: "Agentic Systems in 2026",
      publishedAt: "2026-09-18T12:00:00Z",
      reactionCount: "48",
    });

    expect(post).toBeDefined();
    expect(post?.title).toBe("Agentic Systems in 2026");
    expect(post?.author).toBe("deepmind");
    expect(post?.authorUrl).toBe("https://huggingface.co/deepmind");
    expect(post?.reactionCount).toBe(48);
  });

  it("should validate huggingface community input schema", () => {
    const input = huggingfaceCommunityInputSchema.parse({});
    expect(input.sort).toBe("trending");
    expect(input.limit).toBe(15);
  });

  it("should parse Hugging Face Daily Papers API items", () => {
    const mockData = [
      {
        paper: {
          id: "2405.12345",
          authors: [{ name: "Alice Smith" }, { name: "Bob Jones" }],
          upvotes: 142,
        },
        title: "Autonomous Agent Execution Networks",
        summary: "A novel architecture for long-running autonomous agentic coding systems.",
        publishedAt: "2026-09-19T08:00:00Z",
        numComments: 23,
      },
    ];

    const papers = parseHuggingFacePapers(mockData);
    expect(papers).toHaveLength(1);
    expect(papers[0].id).toBe("2405.12345");
    expect(papers[0].title).toBe("Autonomous Agent Execution Networks");
    expect(papers[0].authors).toEqual(["Alice Smith", "Bob Jones"]);
    expect(papers[0].upvotes).toBe(142);
    expect(papers[0].commentCount).toBe(23);
    expect(papers[0].url).toBe("https://huggingface.co/papers/2405.12345");
  });

  it("should validate huggingface papers input schema", () => {
    const input = huggingfacePapersInputSchema.parse({});
    expect(input.limit).toBe(20);
  });
});

describe("Reddit Parsing & Schemas", () => {
  it("should parse Reddit JSON feed into structured RedditPost array", () => {
    const mockJson = {
      data: {
        children: [
          {
            data: {
              id: "t3_17abc",
              title: "Llama 3 70B quantization benchmark",
              author: "localllama_fan",
              subreddit: "LocalLLaMA",
              score: 412,
              num_comments: 89,
              permalink: "/r/LocalLLaMA/comments/17abc/llama_3_70b_quantization_benchmark/",
              url: "https://www.reddit.com/r/LocalLLaMA/comments/17abc/llama_3_70b_quantization_benchmark/",
              post_hint: "link",
            },
          },
        ],
      },
    };

    const posts = parseRedditJsonFeed(mockJson);
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe("t3_17abc");
    expect(posts[0].title).toBe("Llama 3 70B quantization benchmark");
    expect(posts[0].author).toBe("localllama_fan");
    expect(posts[0].subreddit).toBe("LocalLLaMA");
    expect(posts[0].score).toBe(412);
    expect(posts[0].commentCount).toBe(89);
    expect(posts[0].permalink).toBe("/r/LocalLLaMA/comments/17abc/llama_3_70b_quantization_benchmark/");
  });

  it("should validate Reddit feed input schema defaults", () => {
    const input = redditFeedInputSchema.parse({});
    expect(input.limit).toBe(20);
    expect(input.sort).toBe("hot");
    expect(input.subreddit).toBeUndefined();
  });
});

describe("Lobsters Parsing & Schemas", () => {
  it("should parse Lobsters JSON stories", () => {
    const mockData = [
      {
        short_id: "xyz123",
        short_id_url: "https://lobste.rs/s/xyz123",
        created_at: "2026-09-19T10:00:00.000Z",
        title: "Helmsman: Agent-first Browser Runtime",
        url: "https://github.com/my-tech-journal/helmsman",
        score: 42,
        comment_count: 18,
        description_plain: "Discussion on headless stealth and profile persistence.",
        submitter_user: "kaushal",
        tags: ["browsers", "rust", "automation"],
      },
    ];

    const stories = parseLobstersJson(mockData);
    expect(stories).toHaveLength(1);
    expect(stories[0].id).toBe("xyz123");
    expect(stories[0].title).toBe("Helmsman: Agent-first Browser Runtime");
    expect(stories[0].author).toBe("kaushal");
    expect(stories[0].authorUrl).toBe("https://lobste.rs/~kaushal");
    expect(stories[0].score).toBe(42);
    expect(stories[0].commentCount).toBe(18);
    expect(stories[0].tags).toEqual(["browsers", "rust", "automation"]);
  });

  it("should validate Lobsters input schema defaults", () => {
    const input = lobstersFeedInputSchema.parse({});
    expect(input.sort).toBe("hottest");
    expect(input.limit).toBe(25);
  });
});

describe("Dev.to Parsing & Schemas", () => {
  it("should parse Dev.to articles with reactions and user info", () => {
    const mockArticles = [
      {
        id: 998877,
        title: "Building Resilient AI Agents in 2026",
        description: "A deep dive into anti-bot evasion and browser automation.",
        url: "https://dev.to/kaushal/building-resilient-ai-agents",
        published_timestamp: "2026-09-18T14:30:00Z",
        positive_reactions_count: 156,
        comments_count: 34,
        tag_list: ["ai", "typescript", "architecture"],
        user: { name: "Kaushal", username: "kaushal" },
      },
    ];

    const articles = parseDevToArticles(mockArticles);
    expect(articles).toHaveLength(1);
    expect(articles[0].id).toBe("998877");
    expect(articles[0].title).toBe("Building Resilient AI Agents in 2026");
    expect(articles[0].author).toBe("Kaushal");
    expect(articles[0].authorUrl).toBe("https://dev.to/kaushal");
    expect(articles[0].reactionsCount).toBe(156);
    expect(articles[0].commentsCount).toBe(34);
    expect(articles[0].tags).toEqual(["ai", "typescript", "architecture"]);
  });

  it("should validate Dev.to input schema", () => {
    const input = devtoArticlesInputSchema.parse({ tag: "ai", limit: 10 });
    expect(input.tag).toBe("ai");
    expect(input.top).toBe("7");
    expect(input.limit).toBe(10);
  });
});

describe("Product Hunt Parsing & Schemas", () => {
  it("should parse Product Hunt GraphQL response", () => {
    const mockGraphQL = {
      data: {
        posts: {
          edges: [
            {
              node: {
                id: "54321",
                name: "Helmsman CLI",
                tagline: "Agent-first browser runtime with unified capabilities",
                url: "https://www.producthunt.com/posts/helmsman-cli",
                website: "https://helmsman.run",
                votesCount: 389,
                commentsCount: 65,
                createdAt: "2026-09-19T00:01:00Z",
              },
            },
          ],
        },
      },
    };

    const products = parseProductHuntGraphQL(mockGraphQL);
    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("54321");
    expect(products[0].name).toBe("Helmsman CLI");
    expect(products[0].tagline).toBe("Agent-first browser runtime with unified capabilities");
    expect(products[0].url).toBe("https://helmsman.run");
    expect(products[0].votesCount).toBe(389);
    expect(products[0].commentsCount).toBe(65);
  });

  it("should validate Product Hunt input schema", () => {
    const input = producthuntFeedInputSchema.parse({});
    expect(input.limit).toBe(20);
    expect(input.token).toBeUndefined();
  });
});

describe("arXiv Parsing & Schemas", () => {
  it("should parse arXiv Atom API response with multiple authors and PDF link", () => {
    const mockAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2403.09999v1</id>
    <updated>2026-09-19T12:00:00Z</updated>
    <published>2026-09-18T10:00:00Z</published>
    <title>Scaling Test-Time Compute in Generative Models</title>
    <summary>We analyze the impact of extended test-time computation and chain-of-thought exploration on reasoning benchmarks.</summary>
    <author><name>John Doe</name></author>
    <author><name>Jane Smith</name></author>
    <arxiv:primary_category term="cs.AI" />
    <link href="http://arxiv.org/abs/2403.09999v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2403.09999v1" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

    const papers = parseArxivAtom(mockAtom);
    expect(papers).toHaveLength(1);
    expect(papers[0].id).toBe("2403.09999v1");
    expect(papers[0].title).toBe("Scaling Test-Time Compute in Generative Models");
    expect(papers[0].summary).toContain("We analyze the impact of extended test-time computation");
    expect(papers[0].authors).toEqual(["John Doe", "Jane Smith"]);
    expect(papers[0].category).toBe("cs.AI");
    expect(papers[0].pdfUrl).toBe("http://arxiv.org/pdf/2403.09999v1");
    expect(papers[0].publishedAt).toBe("2026-09-18T10:00:00Z");
  });

  it("should validate arXiv input schema defaults", () => {
    const input = arxivPapersInputSchema.parse({});
    expect(input.category).toBe("cs.AI");
    expect(input.sortBy).toBe("submittedDate");
    expect(input.limit).toBe(20);
  });
});

describe("RSS & Atom Feed Parsing & Presets", () => {
  it("should parse standard RSS 2.0 with CDATA, numeric entities, and HTML summaries", () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Tech News</title>
    <item>
      <title><![CDATA[Apple&#8217;s New M5 Chip Announced]]></title>
      <link>https://example.com/apple-m5</link>
      <guid>https://example.com/apple-m5</guid>
      <pubDate>Thu, 19 Sep 2026 09:30:00 GMT</pubDate>
      <description>&lt;p&gt;Apple has unveiled its latest generation &lt;strong&gt;M5&lt;/strong&gt; processor &amp;amp; architecture.&lt;/p&gt;</description>
      <dc:creator>Jane Reporter</dc:creator>
    </item>
  </channel>
</rss>`;

    const articles = parseFeedXml(mockRss, "Tech News");
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("Apple’s New M5 Chip Announced");
    expect(articles[0].url).toBe("https://example.com/apple-m5");
    expect(articles[0].summary).toBe("Apple has unveiled its latest generation M5 processor & architecture.");
    expect(articles[0].author).toBe("Jane Reporter");
    expect(articles[0].source).toBe("Tech News");
  });

  it("should parse Atom feed with entry links and authors", () => {
    const mockAtom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The Verge</title>
  <entry>
    <title>The future of robotics in 2026</title>
    <link rel="alternate" type="text/html" href="https://theverge.com/robotics-2026"/>
    <id>tag:theverge.com,2026:article:12345</id>
    <published>2026-09-19T08:15:00-04:00</published>
    <summary>Robotics companies are accelerating humanoid deployment.</summary>
    <author><name>Alex Heath</name></author>
  </entry>
</feed>`;

    const articles = parseFeedXml(mockAtom, "The Verge");
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("The future of robotics in 2026");
    expect(articles[0].url).toBe("https://theverge.com/robotics-2026");
    expect(articles[0].id).toBe("tag:theverge.com,2026:article:12345");
    expect(articles[0].summary).toBe("Robotics companies are accelerating humanoid deployment.");
    expect(articles[0].author).toBe("Alex Heath");
  });

  it("should decode XML entities and strip HTML properly", () => {
    // The input's &#x2014; is U+2014 EM DASH, so that is what comes back out.
    expect(decodeXmlEntities("AT&amp;T &quot;smart&quot; quotes &#8217; &#x2014; test")).toBe(
      'AT&T "smart" quotes ’ — test'
    );
    expect(stripHtmlTags("<div><p>Hello <b>world</b>!</p></div>")).toBe("Hello world !");
  });

  it("should have all 20 curated presets configured in RSS_PRESETS", () => {
    const keys = Object.keys(RSS_PRESETS);
    expect(keys).toContain("techcrunch");
    expect(keys).toContain("theverge");
    expect(keys).toContain("arstechnica");
    expect(keys).toContain("infoq");
    expect(keys).toContain("deepmind");
    expect(keys).toContain("openai-news");
    expect(keys).toContain("github-blog");
    expect(keys).toContain("hn-frontpage");
    expect(keys.length).toBe(20);
  });

  it("should validate RSS feed input schema", () => {
    const input = rssFeedInputSchema.parse({ url: "techcrunch", limit: 15 });
    expect(input.url).toBe("techcrunch");
    expect(input.limit).toBe(15);
  });
});
