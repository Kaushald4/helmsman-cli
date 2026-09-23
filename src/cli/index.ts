import readline from "node:readline";
import { createRequire } from "node:module";
import { Command } from "commander";
import { BrowserDriver } from "../driver/browser.js";
import { defaultRegistry } from "../capabilities/registry.js";
import { registerBuiltins } from "../capabilities/builtins/index.js";
import { RSS_PRESETS } from "../capabilities/builtins/rss.js";
import { startMcpServer } from "../mcp/server.js";

// Ensure built-in extractors are registered
registerBuiltins();

/**
 * Read rather than written down.
 *
 * This was a hardcoded string that had already drifted from package.json (it
 * said 0.2.0 while the package said 0.1.0), which makes `--version` and the
 * release it came from disagree. The package is the one place that knows.
 */
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("helmsman")
  .description("An agent-first browser runtime with unified capabilities and native MCP")
  .version(version);

// ---------------------------------------------------------------------------
// AUTH COMMANDS
// ---------------------------------------------------------------------------
const auth = program.command("auth").description("Manage persistent browser profiles and authentication");

auth
  .command("login <profile>")
  .description("Open a headed browser session to log in manually and persist cookies")
  .requiredOption("--site <domain>", "Domain to navigate to for login (e.g. reddit.com)")
  .action(async (profile: string, options: { site: string }) => {
    const driver = new BrowserDriver();
    const targetUrl = options.site.startsWith("http") ? options.site : `https://${options.site}`;

    console.log(`\nLaunching Chrome profile '${profile}'...`);

    const nativeProc = driver.launchNativeChromeForLogin(profile, targetUrl);
    let page: any = null;

    if (nativeProc) {
      console.log(`[Native Mode] Opened genuine Google Chrome with profile '${profile}'.`);
      console.log(`Zero automation flags are active. You can safely log in with passwords, 2FA, or Google/Apple OAuth without risk of account blocking.`);
    } else {
      page = await driver.getPage(profile, { headless: false });
      await page.goto(targetUrl);
      console.log(`Navigated to ${targetUrl}. Complete login/2FA in the browser window.`);
    }

    console.log("Press [Enter] in this terminal when finished to save profile and proceed...");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>((resolve) => {
      rl.question("", () => {
        rl.close();
        resolve();
      });
    });

    if (nativeProc) {
      console.log(`Closing login browser window and releasing profile lock...`);
      await driver.terminateProfileProcess(profile);
    } else if (page) {
      await driver.close(profile);
    }
    console.log(`\nSession saved for profile '${profile}'. Profile ready for automation.\n`);
  });

auth
  .command("close <profile>")
  .description("Terminate any active Chrome process and release locks on a profile")
  .action(async (profile: string) => {
    const driver = new BrowserDriver();
    const lock = driver.getProfileLock(profile);
    if (!lock) {
      driver.cleanProfileLocks(profile);
      console.log(`No active locks on profile '${profile}'. Cleaned any stale artifacts.`);
      return;
    }
    if (lock.isAlive) {
      console.log(`Terminating Chrome process (PID ${lock.pid}) for profile '${profile}'...`);
      await driver.terminateProfileProcess(profile);
      console.log(`Process terminated and profile '${profile}' unlocked.`);
    } else {
      driver.cleanProfileLocks(profile);
      console.log(`Cleaned stale lock (PID ${lock.pid}) on profile '${profile}'.`);
    }
  });

auth
  .command("export <profile>")
  .description("Export profile session storage and cookies to a JSON state file")
  .option("--out <file>", "Output file path (default: ./<profile>-state.json)")
  .action(async (profile: string, options: { out?: string }) => {
    const path = await import("node:path");
    const driver = new BrowserDriver();
    const outPath = options.out || path.join(process.cwd(), `${profile}-state.json`);
    try {
      console.log(`Exporting session state for profile '${profile}'...`);
      await driver.exportStorageState(profile, outPath);
      console.log(`Session state saved to: ${outPath}`);
    } catch (err) {
      console.error("Export failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

auth
  .command("list")
  .description("List all saved browser profiles")
  .action(() => {
    const driver = new BrowserDriver();
    const profiles = driver.listProfiles();
    if (profiles.length === 0) {
      console.log("No profiles found. Create one with 'helmsman auth login <profile> --site <domain>'.");
    } else {
      console.log("Available profiles:");
      for (const p of profiles) {
        console.log(` - ${p} (${driver.getProfilePath(p)})`);
      }
    }
  });

auth
  .command("status <profile>")
  .description("Check status and path of a specific profile")
  .action((profile: string) => {
    const driver = new BrowserDriver();
    const path = driver.getProfilePath(profile);
    const exists = driver.listProfiles().includes(profile);
    console.log(`Profile: ${profile}`);
    console.log(`Status:  ${exists ? "Configured" : "Not Found"}`);
    console.log(`Path:    ${path}`);
  });

// ---------------------------------------------------------------------------
// MCP SERVER COMMAND
// ---------------------------------------------------------------------------
program
  .command("mcp")
  .description("Start the native Model Context Protocol (MCP) server over stdio")
  .option("--profile <profile>", "Profile name to use for browser sessions", "default")
  .option("--headed", "Run browser in visible mode (default is headless)", false)
  .action(async (options: { profile: string; headed: boolean }) => {
    await startMcpServer({
      profileName: options.profile,
      headless: !options.headed,
    });
  });

// ---------------------------------------------------------------------------
// REDDIT COMMAND GROUP
// ---------------------------------------------------------------------------
const reddit = program.command("reddit").description("Extract Reddit feeds and discussions");

reddit
  .command("feed <profile>")
  .description("Extract posts from Reddit home or a subreddit")
  .option("--subreddit <name>", "Specific subreddit (e.g. 'technology')")
  .option("--sort <sort>", "Sort order (hot, new, top)", "hot")
  .option("--limit <number>", "Number of posts to extract", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(
    async (
      profile: string,
      options: { subreddit?: string; sort: "hot" | "new" | "top"; limit: string; headed: boolean }
    ) => {
      const driver = new BrowserDriver();
      const capability = defaultRegistry.get("reddit.feed");
      if (!capability) throw new Error("reddit.feed capability not found");

      try {
        const page = await driver.getPage(profile, { headless: !options.headed });
        const results = await capability.execute(
          { page, driver, profileName: profile },
          {
            limit: Number.parseInt(options.limit, 10) || 20,
            subreddit: options.subreddit,
            sort: options.sort,
          }
        );
        console.log(JSON.stringify(results, null, 2));
      } catch (err) {
        console.error("Execution failed:", err instanceof Error ? err.message : err);
        process.exit(1);
      } finally {
        await driver.close(profile);
      }
    }
  );

// ---------------------------------------------------------------------------
// TWITTER COMMAND GROUP
// ---------------------------------------------------------------------------
const twitter = program.command("twitter").description("Extract X/Twitter timeline and searches");

twitter
  .command("feed <profile>")
  .description("Extract tweets from authenticated home timeline")
  .option("--limit <number>", "Number of tweets to extract", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile: string, options: { limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("twitter.feed");
    if (!capability) throw new Error("twitter.feed capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        { limit: Number.parseInt(options.limit, 10) || 20 }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

twitter
  .command("search <profile> <query>")
  .description("Search X/Twitter tweets")
  .option("--sort <sort>", "Sort order (top, latest)", "top")
  .option("--limit <number>", "Number of tweets to extract", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile: string, query: string, options: { sort: "top" | "latest"; limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("twitter.search");
    if (!capability) throw new Error("twitter.search capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          query,
          sort: options.sort,
          limit: Number.parseInt(options.limit, 10) || 20,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// HACKER NEWS COMMAND GROUP
// ---------------------------------------------------------------------------
const hn = program.command("hackernews").description("Extract Hacker News stories");

hn
  .command("feed [profile]")
  .description("Extract front page stories from news.ycombinator.com")
  .option("--limit <number>", "Number of stories to extract", "30")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("hackernews.feed");
    if (!capability) throw new Error("hackernews.feed capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        { limit: Number.parseInt(options.limit, 10) || 30 }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

hn
  .command("search <query>")
  .description("Search Hacker News via official Algolia API (instant, no browser needed)")
  .option("--sort <sort>", "Sort order: 'date' or 'points'", "date")
  .option("--min-points <number>", "Minimum points filter", "0")
  .option("--limit <number>", "Number of results", "20")
  .action(async (query: string, options: { sort: "date" | "points"; minPoints: string; limit: string }) => {
    const capability = defaultRegistry.get("hackernews.search");
    if (!capability) throw new Error("hackernews.search capability not found");

    try {
      const results = await capability.execute(
        {} as any,
        {
          query,
          sort: options.sort,
          minPoints: Number.parseInt(options.minPoints, 10) || 0,
          limit: Number.parseInt(options.limit, 10) || 20,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Search failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// LINKEDIN COMMAND GROUP
// ---------------------------------------------------------------------------
const linkedin = program.command("linkedin").description("Extract LinkedIn jobs and feeds");

linkedin
  .command("jobs <profile> <keywords>")
  .description("Search LinkedIn jobs with title, company, location, and links")
  .option("--location <location>", "Geographical location filter")
  .option("--limit <number>", "Number of jobs", "15")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile: string, keywords: string, options: { location?: string; limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("linkedin.jobs");
    if (!capability) throw new Error("linkedin.jobs capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          keywords,
          location: options.location,
          limit: Number.parseInt(options.limit, 10) || 15,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

linkedin
  .command("feed <profile>")
  .description("Extract posts from LinkedIn home feed")
  .option("--limit <number>", "Number of feed posts", "10")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile: string, options: { limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("linkedin.feed");
    if (!capability) throw new Error("linkedin.feed capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        { limit: Number.parseInt(options.limit, 10) || 10 }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// HUGGING FACE COMMAND GROUP
// ---------------------------------------------------------------------------
const hf = program.command("huggingface").description("Extract Hugging Face community discussions");

hf
  .command("community [profile]")
  .description("Extract Hugging Face community blog posts and discussions")
  .option("--sort <sort>", "Sort by 'trending' or 'recent'", "trending")
  .option("--limit <number>", "Number of posts", "15")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { sort: "trending" | "recent"; limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("huggingface.community");
    if (!capability) throw new Error("huggingface.community capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          sort: options.sort,
          limit: Number.parseInt(options.limit, 10) || 15,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

hf
  .command("papers [profile]")
  .description("Extract trending daily AI research papers from Hugging Face")
  .option("--limit <number>", "Number of papers", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("huggingface.papers");
    if (!capability) throw new Error("huggingface.papers capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        { limit: Number.parseInt(options.limit, 10) || 20 }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// LOBSTERS COMMAND GROUP
// ---------------------------------------------------------------------------
const lobsters = program.command("lobsters").description("Extract Lobste.rs stories and discussions");

lobsters
  .command("feed [profile]")
  .description("Extract stories from Lobste.rs front page or newest feed")
  .option("--sort <sort>", "Sort order: 'hottest' or 'newest'", "hottest")
  .option("--limit <number>", "Number of stories", "25")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { sort: "hottest" | "newest"; limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("lobsters.feed");
    if (!capability) throw new Error("lobsters.feed capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          sort: options.sort,
          limit: Number.parseInt(options.limit, 10) || 25,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// DEV.TO COMMAND GROUP
// ---------------------------------------------------------------------------
const devto = program.command("devto").description("Extract technical articles and tutorials from Dev.to");

devto
  .command("articles [profile]")
  .description("Extract top technical articles from Dev.to")
  .option("--tag <tag>", "Filter by tag (e.g. 'ai', 'webdev', 'python')")
  .option("--top <days>", "Time window in days ('7', '30', '365', 'infinity')", "7")
  .option("--limit <number>", "Number of articles", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { tag?: string; top: string; limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("devto.articles");
    if (!capability) throw new Error("devto.articles capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          tag: options.tag,
          top: options.top,
          limit: Number.parseInt(options.limit, 10) || 20,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// PRODUCT HUNT COMMAND GROUP
// ---------------------------------------------------------------------------
const producthunt = program.command("producthunt").description("Extract top daily ranked products from Product Hunt");

producthunt
  .command("feed [profile]")
  .description("Extract top products from Product Hunt leaderboard")
  .option("--limit <number>", "Number of products", "20")
  .option("--token <token>", "Optional Product Hunt Developer Token")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { limit: string; token?: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("producthunt.feed");
    if (!capability) throw new Error("producthunt.feed capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          limit: Number.parseInt(options.limit, 10) || 20,
          token: options.token,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// ARXIV COMMAND GROUP
// ---------------------------------------------------------------------------
const arxiv = program.command("arxiv").description("Extract scientific research papers from arXiv");

arxiv
  .command("papers [profile]")
  .description("Extract scientific research papers from arXiv across CS, AI, and related fields")
  .option("--category <category>", "arXiv category (e.g. 'cs.AI', 'cs.LG', 'cs.CL')", "cs.AI")
  .option("--query <query>", "Search query within title/abstract")
  .option("--sort <sort>", "Sort field: 'submittedDate', 'lastUpdatedDate', 'relevance'", "submittedDate")
  .option("--limit <number>", "Number of papers", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (profile = "default", options: { category: string; query?: string; sort: "submittedDate" | "lastUpdatedDate" | "relevance"; limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("arxiv.papers");
    if (!capability) throw new Error("arxiv.papers capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          category: options.category,
          query: options.query,
          sortBy: options.sort,
          limit: Number.parseInt(options.limit, 10) || 20,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// RSS / ATOM COMMAND GROUP
// ---------------------------------------------------------------------------
const rss = program.command("rss").description("Extract articles from RSS and Atom feeds");

rss
  .command("feed <url-or-preset> [profile]")
  .description("Extract articles from an RSS/Atom feed URL or built-in preset alias")
  .option("--limit <number>", "Number of articles", "20")
  .option("--headed", "Run browser in visible mode", false)
  .action(async (urlOrPreset: string, profile = "default", options: { limit: string; headed: boolean }) => {
    const driver = new BrowserDriver();
    const capability = defaultRegistry.get("rss.feed");
    if (!capability) throw new Error("rss.feed capability not found");

    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      const results = await capability.execute(
        { page, driver, profileName: profile },
        {
          url: urlOrPreset,
          limit: Number.parseInt(options.limit, 10) || 20,
        }
      );
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error("Execution failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

rss
  .command("presets")
  .description("List all 20 built-in RSS feed presets")
  .action(() => {
    console.log("\nCurated Built-in RSS Presets:\n");
    for (const [alias, info] of Object.entries(RSS_PRESETS)) {
      const categoryTag = info.category ? `[${info.category}]` : "";
      console.log(`  * ${alias.padEnd(22)} ${categoryTag.padEnd(20)} ${info.name} -> ${info.url}`);
    }
    console.log("\nUsage: helmsman rss feed <preset-name>\nExample: helmsman rss feed techcrunch --limit 10\n");
  });

// ---------------------------------------------------------------------------
// CAPABILITY LISTING COMMAND
// ---------------------------------------------------------------------------
program
  .command("capabilities")
  .description("List all registered capabilities available to CLI and MCP")
  .action(() => {
    const list = defaultRegistry.list();
    console.log(`\nRegistered Capabilities (${list.length}):\n`);
    for (const cap of list) {
      console.log(`  * ${cap.id.padEnd(25)} [${cap.riskLevel}] - ${cap.description}`);
    }
    console.log("");
  });

// ---------------------------------------------------------------------------
// AUDIT COMMAND GROUP
// ---------------------------------------------------------------------------
const audit = program.command("audit").description("Inspect durable execution audit logs");

audit
  .command("query")
  .description("Query audit entries with optional filters")
  .option("--workflow <id>", "Filter by workflow ID")
  .option("--domain <domain>", "Filter by domain")
  .option("--status <status>", "Filter by status (success, failed, blocked)")
  .action(async (options: { workflow?: string; domain?: string; status?: "success" | "failed" | "blocked" }) => {
    const { defaultAuditWriter } = await import("../audit/index.js");
    const entries = defaultAuditWriter.query({
      workflowId: options.workflow,
      domain: options.domain,
      status: options.status,
    });

    if (entries.length === 0) {
      console.log("No audit entries found matching filter.");
    } else {
      console.log(JSON.stringify(entries, null, 2));
    }
  });

// ---------------------------------------------------------------------------
// METRICS COMMAND GROUP
// ---------------------------------------------------------------------------
const metrics = program.command("metrics").description("Inspect runtime performance and success metrics");

metrics
  .command("show")
  .description("Display aggregated execution metrics")
  .action(async () => {
    const { defaultAuditWriter } = await import("../audit/index.js");
    const entries = defaultAuditWriter.query();
    const stats = defaultAuditWriter.computeMetrics(entries);

    console.log("\n=== Helmsman Runtime Metrics ===\n");
    console.log(`Total Invocations: ${stats.totalInvocations}`);
    console.log(`Successful:        ${stats.successful}`);
    console.log(`Failed:            ${stats.failed}`);
    console.log(`Blocked by Policy: ${stats.blocked}`);
    console.log(`Average Latency:   ${stats.averageDurationMs}ms\n`);

    const workflows = Object.entries(stats.byWorkflow);
    if (workflows.length > 0) {
      console.log("By Workflow:");
      for (const [id, w] of workflows) {
        console.log(`  - ${id.padEnd(25)} runs: ${w.total}, success rate: ${(w.successRate * 100).toFixed(1)}%`);
      }
      console.log("");
    }
  });
program
  .command("run <profile>")
  .description("Replay a declarative workflow YAML file with optional self-healing and anti-bot humanization")
  .requiredOption("--workflow <path>", "Path to .workflow.yaml file")
  .option("-i, --input <key=value...>", "Workflow input variables", (val: string, prev: string[]) => prev.concat([val]), [])
  .option("--headed", "Run browser in visible mode", false)
  .option("--heal", "Enable tiered self-healing across DOM drifts", false)
  .option("--speed <speed>", "Execution pacing: 'human' (realistic biometrics & delays), 'fast', or 'instant'", "human")
  .option("--delay <ms>", "Custom base delay between steps in milliseconds")
  .action(async (profile: string, options: {
    workflow: string;
    input: string[];
    headed: boolean;
    heal: boolean;
    speed: "human" | "fast" | "instant";
    delay?: string;
  }) => {
    const fs = await import("node:fs");
    const { parseWorkflow, ReplayExecutor } = await import("../workflow/index.js");

    if (!fs.existsSync(options.workflow)) {
      console.error(`Error: Workflow file not found at '${options.workflow}'`);
      process.exit(1);
    }

    const yamlText = fs.readFileSync(options.workflow, "utf8");
    const ast = parseWorkflow(yamlText);

    const inputRecord: Record<string, string> = {};
    for (const pair of options.input) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx !== -1) {
        inputRecord[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }

    const driver = new BrowserDriver();
    try {
      const page = await driver.getPage(profile, { headless: !options.headed });
      let result: any;

      const replayOpts = {
        speed: options.speed,
        interStepDelayMs: options.delay ? Number.parseInt(options.delay, 10) : undefined,
      };

      if (options.heal) {
        const { RepairExecutor } = await import("../healing/index.js");
        const repairExecutor = new RepairExecutor();
        result = await repairExecutor.run(ast, page, inputRecord, {
          workflowFilePath: options.workflow,
          ...replayOpts,
        });
        if (result.healed) {
          console.log(`\n✨ Workflow successfully self-healed and patched on disk: ${options.workflow}`);
        }
      } else {
        const executor = new ReplayExecutor();
        result = await executor.run(ast, page, inputRecord, replayOpts);
      }

      console.log(JSON.stringify(result, null, 2));
      if (result.status === "failed") {
        process.exit(1);
      }
    } catch (err) {
      console.error("Workflow failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await driver.close(profile);
    }
  });

// ---------------------------------------------------------------------------
// WORKFLOW RECORD COMMAND
// ---------------------------------------------------------------------------
program
  .command("record <profile>")
  .description("Record a human browser session into a declarative Workflow AST YAML file")
  .requiredOption("--site <domain>", "Initial website domain to record (e.g. github.com)")
  .requiredOption("--id <id>", "Workflow identifier (e.g. github.myFlow)")
  .option("--out <path>", "Output file path (default: ./recordings/<id>.workflow.yaml)")
  .option("--parameterize", "Convert filled values into input parameters", false)
  .action(
    async (
      profile: string,
      options: { site: string; id: string; out?: string; parameterize: boolean }
    ) => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const readline = await import("node:readline");
      const { WorkflowRecorder, compileWorkflow, serializeWorkflow } = await import(
        "../workflow/index.js"
      );

      const driver = new BrowserDriver();
      const targetUrl = options.site.startsWith("http") ? options.site : `https://${options.site}`;

      console.log(`\nStarting recording session '${options.id}' on ${options.site}...`);
      try {
        const page = await driver.getPage(profile, { headless: false });

        const recorder = new WorkflowRecorder(page);
        await recorder.start();
        await page.goto(targetUrl);

        console.log(`\nRecording active in Chrome window! Click and type normally.`);
        console.log(`When finished, press [Enter] in this terminal to compile the workflow...\n`);

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((resolve) => {
          rl.question("", () => {
            rl.close();
            resolve();
          });
        });

        const events = recorder.stop();
        await driver.close(profile);

        console.log(`\nCaptured ${events.length} interaction events. Compiling Workflow AST...`);
        const ast = compileWorkflow(events, {
          id: options.id,
          domain: options.site,
          parameterizeFills: options.parameterize,
        });

        const yaml = serializeWorkflow(ast);
        const outPath = options.out || path.join(process.cwd(), "recordings", `${options.id}.workflow.yaml`);

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, yaml, "utf8");

        console.log(`\nWorkflow compiled successfully!`);
        console.log(`Saved to: ${outPath}`);
        console.log(`Steps (${ast.steps.length}):`);
        for (const s of ast.steps) {
          console.log(`  - [${s.type}] ${s.intent || s.id}`);
        }
        console.log(`Risk level: ${ast.riskLevel}\n`);
      } catch (err) {
        console.error(`\nRecording failed:`, err instanceof Error ? err.message : err);
        await driver.close(profile).catch(() => {});
        process.exit(1);
      }
    }
  );

program.parse(process.argv);
