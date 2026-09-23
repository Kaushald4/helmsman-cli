# Helmsman

>**The agent-first browser runtime that bypasses bot detection, maintains persistent sessions and actually scrapes data.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Tests-59%2F59%20Passing-brightgreen.svg)](https://vitest.dev/)
[![MCP](https://img.shields.io/badge/MCP-Native%20Stdio-purple.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Why does this exist?

Automating the modern web in 2026 is painful:

- **Bot detection kills basic scripts**: Launch vanilla Puppeteer or Playwright, and Cloudflare Turnstile, DataDome, or Akamai flag you within 200ms. Your User-Agent leaks `HeadlessChrome`, your `navigator.webdriver` is exposed, and machine-speed clicks get your accounts shadowbanned.
- **Logins are fortified**: Try logging into Google, LinkedIn, or Twitter through standard automated browsers and you'll hit *"This browser or app may not be secure."*
- **Chromium profile lock nightmares**: Re-attaching to a Chrome profile directory usually throws `Opening in existing browser session` and crashes.
- **Virtualized feeds return empty data**: Modern apps (Reddit, Twitter, LinkedIn) mount and unmount feed items on the fly using `IntersectionObserver`. Naive scrapers scroll too fast or in zero-sized headless viewports and end up with `[]`.

**Helmsman solves this from the ground up.** It's built for developers and autonomous AI agents who need reliable, stealthy web interaction with zero drama.

---

## Core Capabilities

### Stealth & Anti-Bot Evasion
- **Zero Automation Tells**: Strips `--enable-automation`, `--no-sandbox`, `--use-mock-keychain`, and mock password store flags.
- **Prototype-Level Masking**: Defends `Function.prototype.toString` against tampering inspection (CreepJS and Incolumitas compliant), unmasks authentic hardware WebGL renderers, and normalizes window geometry.
- **Headless Parity**: Runs `--headless=new` with explicit desktop viewports and platform-native User-Agents to prevent CDN-level `HeadlessChrome` edge blocking.

### Session & Identity Management
- **Native OS Authentication**: Launches your system Google Chrome binary outside automation protocols for manual logins, bypassing Google and Twitter bot checkpoints.
- **Automated Lock Recovery**: Resolves Chromium `SingletonLock` conflicts automatically, terminates orphaned processes, and clears stale IPC locks.
- **Isolated Profiles**: Manages persistent session storage states and cookie jars across separate, named profiles.

### Agentic Execution & Self-Healing
- **Humanized Biometrics**: Replays interactions with non-linear cursor trajectories, variable dwell times, trusted mouse wheel scrolls, and Gaussian keystroke jitter.
- **Multi-Tier Self-Healing**: Recovers broken step selectors using structural DOM heuristics, accessibility tree queries, and optional LLM fallback.
- **Declarative Workflows**: Compiles recorded sessions into strongly-typed YAML ASTs with consecutive scroll debouncing and interactive ancestor detection.

### Data Extraction & MCP
- **14 Built-in Capabilities**: Native extractors for Reddit, Twitter/X, Hacker News, LinkedIn, Hugging Face, Lobste.rs, Dev.to, Product Hunt, arXiv, and RSS/Atom feeds.
- **Dual-Mode Fallback**: Executes fast API/JSON fetches when available, falling back seamlessly to authenticated in-browser DOM parsing.
- **Native Model Context Protocol**: Serves all tools and capabilities over stdio for instant integration with Claude Desktop, Cursor, and AI agent frameworks.

---

## Quick Start

### 1. Prerequisites
- **Node.js**: >= 20.0.0
- **pnpm**: Recommended package manager
- **Google Chrome**: System-installed Google Chrome (macOS, Linux, or Windows)

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/Kaushald4/helmsman-cli.git
cd helmsman-cli

# Install dependencies
pnpm install

# Build the CLI
pnpm build
```

Link the binary globally if you want `helmsman` in your PATH:

```bash
pnpm link --global
```

Or run directly via Node:

```bash
node dist/cli.js --help
```

---

## The Workflow

### Step 1: Log in Once (Zero Bot Detection)
Need to interact with a site that requires authentication (Reddit, Twitter, LinkedIn)? Run `auth login`. 

This opens a native instance of your system Google Chrome—**completely outside Playwright and with zero automation flags**—so Google and Twitter let you sign in without warnings:

```bash
# Open real Chrome to log into Reddit
node dist/cli.js auth login my-reddit-profile --site reddit.com

# Or Twitter/X
node dist/cli.js auth login my-x-profile --site x.com
```

Log in with your credentials, MFA, or Passkey. When you finish, press `[Enter]` in your terminal. Your session cookies and local storage are saved to the profile.

### Step 2: Extract Clean Data

Now extract content using your authenticated profile or run zero-auth public commands in headless mode:

```bash
# Extract Reddit posts from a subreddit
node dist/cli.js reddit feed my-reddit-profile --subreddit localllama --limit 20

# Search Twitter/X with your logged-in profile
node dist/cli.js twitter search my-x-profile "deepseek" --sort top --limit 15

# Search LinkedIn jobs
node dist/cli.js linkedin jobs my-linkedin-profile "AI Engineer" --location "San Francisco"

# Pull arXiv research preprints
node dist/cli.js arxiv papers --category cs.AI --query "reasoning" --limit 10

# Read trending Hugging Face daily papers
node dist/cli.js huggingface papers --limit 15

# Read Lobste.rs front page
node dist/cli.js lobsters feed --limit 25

# Read Dev.to AI articles
node dist/cli.js devto articles --tag ai --limit 20

# Read any RSS or Atom feed directly (or use a built-in preset)
node dist/cli.js rss feed techcrunch --limit 10
node dist/cli.js rss feed deepmind --limit 10
node dist/cli.js rss feed https://openai.com/news/rss.xml
```

---

## Built-in Extractors

Helmsman ships with 14 out-of-the-box capabilities. Each capability supports dual-mode execution (fast API/JSON extraction with automatic fallback to stealth browser rendering):

| Category | Capability | Command | Description |
|---|---|---|---|
| **Social & News** | `reddit.feed` | `helmsman reddit feed <profile> [--subreddit <name>]` | Extracts subreddit or home feed with upvotes and comments. |
| | `twitter.feed` | `helmsman twitter feed <profile>` | Extracts authenticated home timeline tweets with metrics. |
| | `twitter.search` | `helmsman twitter search <profile> <query>` | Searches tweets by keyword or hashtag. |
| | `hackernews.feed` | `helmsman hackernews feed` | Front-page Hacker News stories with points and discussion links. |
| | `hackernews.search` | `helmsman hackernews search <query>` | Instant HN search via official Algolia index. |
| | `lobsters.feed` | `helmsman lobsters feed [--sort hottest\|newest]` | Front-page tech discussions and tags from Lobste.rs. |
| | `devto.articles` | `helmsman devto articles [--tag <tag>]` | Top technical articles and tutorials from Dev.to. |
| | `producthunt.feed` | `helmsman producthunt feed` | Daily ranked products (uses API token if set, or scrapes zero-auth). |
| **Professional** | `linkedin.jobs` | `helmsman linkedin jobs <profile> <keywords>` | Job cards with title, company, location, and apply URLs. |
| | `linkedin.feed` | `helmsman linkedin feed <profile>` | Authenticated LinkedIn professional feed posts. |
| **Research & AI** | `arxiv.papers` | `helmsman arxiv papers [--category <cat>]` | arXiv preprints with authors, abstracts, and direct PDF links. |
| | `huggingface.papers` | `helmsman huggingface papers` | Trending daily AI research papers from Hugging Face. |
| | `huggingface.community`| `helmsman huggingface community` | Community blog posts and engineering tutorials. |
| **Syndication** | `rss.feed` | `helmsman rss feed <url-or-preset>` | Universal RSS 2.0 & Atom feed parser. |

To list all 20 curated RSS presets (`techcrunch`, `theverge`, `deepmind`, `openai-news`, `github-blog`, etc.):

```bash
node dist/cli.js rss presets
```

---

## Recording & Replaying Workflows

Helmsman features a human-first recorder and player that generates readable, declarative YAML workflows.

### 1. Record a Human Session
```bash
node dist/cli.js record my-profile --site example.com --id site-tour
```
Interact with the browser normally. Helmsman automatically captures:
- Resilient semantic selectors (ARIA roles, test IDs, visible text).
- Clickable ancestor detection (handles SVG icons, buttons, hamburger menus, and dropdowns).
- Smooth debounced scrolling on pages and custom scrollable containers.
- Natural hover triggers for flyout menus.

The session is compiled into `recordings/site-tour.yaml`.

### 2. Replay with Human Pacing & Self-Healing
```bash
# Run with natural human pacing (recommended)
node dist/cli.js run my-profile recordings/site-tour.yaml --speed human

# Run faster in CI or headless environments
node dist/cli.js run my-profile recordings/site-tour.yaml --speed fast
```

If a website changed an ID or modified a class name, Helmsman's self-healing engine steps in:
1. **DOM Heuristic Resolver**: Recovers matching elements via structural parent/child similarity.
2. **Accessibility Tree Resolver**: Locates elements by role and accessible name.
3. **LLM Resolver** (optional): Analyzes the DOM snapshot to intelligently find the intended target.

---

## Using Helmsman as an MCP Server

Helmsman has native [Model Context Protocol](https://modelcontextprotocol.io/) support. You can connect it to Claude Desktop, Cursor, Antigravity, or any agent framework to give your LLM real browser powers and clean scrapers.

### Running the Server
```bash
node dist/cli.js mcp
```

### Claude Desktop Configuration
Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "helmsman": {
      "command": "node",
      "args": ["/absolute/path/to/helmsman-cli/dist/cli.js", "mcp"]
    }
  }
}
```

Now Claude can directly call tools like `rss_feed`, `arxiv_papers`, `reddit_feed`, `lobsters_feed`, or replay workflows on your behalf.

---

## Project Structure

```
helmsman-cli/
├── src/
│   ├── capabilities/      # Unified capabilities registry & platform extractors
│   │   ├── builtins/      # Built-in scrapers (Reddit, Twitter, HN, arXiv, RSS, etc.)
│   │   ├── registry.ts    # Capability discovery and lifecycle management
│   │   └── types.ts       # Capability contracts and Zod schemas
│   ├── driver/            # Browser execution engine
│   │   ├── actions.ts     # Human biometrics (wheel scrolls, Gaussian typing, Bézier moves)
│   │   ├── browser.ts     # Profile lock resolution, stealth flags, native OS login
│   │   └── stealth.ts     # CreepJS/DataDome stealth evasions
│   ├── workflow/          # Declarative automation
│   │   ├── ast.ts         # Strongly-typed YAML workflow AST schemas
│   │   ├── compiler.ts    # Consecutive action merging and selector optimization
│   │   ├── recorder.ts    # In-browser interaction listener (pointerdown, hover, scroll)
│   │   └── replay.ts      # Humanized playback engine with cognitive delays
│   ├── healing/           # Multi-tier self-healing engine (DOM, A11y, LLM)
│   ├── policy/            # Risk classification and execution guardrails
│   ├── audit/             # Durable JSONL execution logging and telemetry
│   ├── mcp/               # Model Context Protocol stdio server
│   └── cli/               # Command-line interface definitions
└── test/                  # Comprehensive Vitest unit test suite
```

---

## Development & Testing

```bash
# Run unit tests
pnpm test

# Run tests in watch mode
pnpm vitest

# Run TypeScript strict type-check
pnpm typecheck

# Build release bundle
pnpm build
```

---

## Contributing

Pull requests are welcome! If you're adding a new extractor or extending the stealth layer:
1. Make sure your extractor implements `Capability<TInput, TOutput>`.
2. Provide fallback mechanisms (don't fail completely on missing API tokens).
3. Write unit tests in `test/` verifying parsing logic and schema contracts.
4. Run `pnpm test && pnpm typecheck` before submitting.

---

## License

[MIT](LICENSE) © [Kaushal](https://github.com/my-tech-journal)
