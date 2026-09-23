# Helmsman

A Node CLI that drives a real Chrome to collect data from sites that block
headless browsers. It also serves the same capabilities over the Model Context
Protocol, so an agent can call them.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Native%20Stdio-purple.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why it works this way

Automated browsers get caught. Playwright and Puppeteer expose enough signals
that some sites block them outright, and a few logins, notably Google and X,
simply refuse to finish in an automated context.

So sign-in does not happen in an automated browser. `auth login` launches your
installed Google Chrome against a dedicated profile directory, outside the
automation protocol, and you log in by hand. The cookies and local storage stay
in that profile, and later runs reuse them.

Two smaller problems come with the same territory. Chrome holds a lock on a
profile while it is open, so attaching to a profile that is still running fails;
Helmsman clears the stale lock instead. And feeds that mount items as you scroll
return empty lists to a scraper that scrolls too fast, so scrolling is paced and
items are collected as they appear.

The stealth work is about not being the obvious outlier: real User-Agent and
WebGL values, plausible window geometry, no automation flags, and no
`HeadlessChrome` in anything the page can read.

## Install

Node 20 or newer, pnpm, and Google Chrome installed on the system.

```bash
git clone https://github.com/Kaushald4/helmsman-cli.git
cd helmsman-cli
pnpm install
pnpm build
```

Put `helmsman` on your PATH if you want it globally:

```bash
pnpm link --global
```

Otherwise run it through Node:

```bash
node dist/cli.js --help
```

## Log in once

For Reddit, X or LinkedIn, create a profile and sign in through it:

```bash
node dist/cli.js auth login my-reddit-profile --site reddit.com
```

Chrome opens. Log in with whatever the site asks for, password, MFA or passkey,
then press Enter in the terminal. Helmsman closes the browser and keeps the
session in that profile.

## Collect data

Public sources need no profile. The ones behind a login use the profile you
signed into.

```bash
# Reddit, from a subreddit
node dist/cli.js reddit feed my-reddit-profile --subreddit localllama --limit 20

# X search, using a signed-in profile
node dist/cli.js twitter search my-x-profile "deepseek" --sort top --limit 15

# LinkedIn jobs
node dist/cli.js linkedin jobs my-linkedin-profile "AI Engineer" --location "San Francisco"

# arXiv, Hugging Face papers, Lobste.rs, Dev.to
node dist/cli.js arxiv papers --category cs.AI --query "reasoning" --limit 10
node dist/cli.js huggingface papers --limit 15
node dist/cli.js lobsters feed --limit 25
node dist/cli.js devto articles --tag ai --limit 20

# RSS, by preset or by URL
node dist/cli.js rss feed techcrunch --limit 10
node dist/cli.js rss feed https://openai.com/news/rss.xml
```

Each capability tries the fastest route first. Where a site offers a JSON or API
endpoint, that is used; otherwise it falls back to reading the page in the
browser, authenticated when the source needs it.

## Capabilities

| Command | What it returns |
|---|---|
| `helmsman reddit feed <profile> [--subreddit <name>]` | Posts with scores and comment counts |
| `helmsman twitter feed <profile>` | Your home timeline, with metrics |
| `helmsman twitter search <profile> <query>` | Tweets matching a keyword or hashtag |
| `helmsman hackernews feed` | Front page stories, with discussion links |
| `helmsman hackernews search <query>` | Instant search through the Algolia index |
| `helmsman lobsters feed [--sort hottest\|newest]` | Front page discussions and tags |
| `helmsman devto articles [--tag <tag>]` | Technical articles |
| `helmsman producthunt feed` | Daily ranked products, API token or not |
| `helmsman linkedin jobs <profile> <keywords>` | Job cards with company, location and apply URL |
| `helmsman linkedin feed <profile>` | Your LinkedIn feed |
| `helmsman arxiv papers [--category <cat>]` | Preprints with authors, abstracts and PDF links |
| `helmsman huggingface papers` | Trending daily papers |
| `helmsman huggingface community` | Community posts and tutorials |
| `helmsman rss feed <url-or-preset>` | Any RSS 2.0 or Atom feed |

There are 20 RSS presets, including `techcrunch`, `theverge`, `deepmind`,
`openai-news` and `github-blog`. List them with:

```bash
node dist/cli.js rss presets
```

## Recording and replaying a session

Useful when a site has no API and the page is more work than a selector list.

```bash
node dist/cli.js record my-profile --site example.com --id site-tour
```

Browse normally and Helmsman writes down what you did: rAF-stable selectors
based on roles, test ids and visible text, clicks resolved to their clickable
ancestor so icon buttons work, debounced scrolling, and hover triggers for
menus that open on hover. The result is `recordings/site-tour.yaml`, which is
readable and editable by hand.

```bash
node dist/cli.js run my-profile recordings/site-tour.yaml --speed human
node dist/cli.js run my-profile recordings/site-tour.yaml --speed fast
```

When a site changes and a step no longer matches, replay tries three things in
order: structural similarity in the DOM, a lookup by accessible role and name,
and, if an LLM is configured, a look at the page snapshot.

## MCP server

```bash
node dist/cli.js mcp
```

For Claude Desktop, add to `claude_desktop_config.json`:

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

The agent can then call the capabilities above, and replay workflows.

## Layout

```
src/
  capabilities/   capability registry, builtins, output schemas
  driver/         browser launch, stealth, profile locks, input pacing
  workflow/       record, AST, compile, replay
  healing/        the three recovery tiers
  policy/         risk checks before an action runs
  audit/          JSONL execution log
  mcp/            MCP stdio server
  cli/            command definitions
test/             vitest suite
recordings/       recorded workflows (gitignored)
```

## Development

```bash
pnpm test        # unit tests
pnpm vitest      # watch mode
pnpm typecheck   # tsc, strict
pnpm build       # bundle to dist/
```

## Contributing

1. A new extractor implements `Capability<TInput, TOutput>` and registers itself
   in the capabilities registry.
2. Provide the fallback path. Missing API tokens should downgrade the run, not
   fail it.
3. Add tests under `test/` covering parsing and the output schema, then run
   `pnpm test && pnpm typecheck`.



© [Kaushal](https://github.com/Kaushald4)
