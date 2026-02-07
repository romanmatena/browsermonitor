#!/usr/bin/env node
/**
 * Browser Monitor CLI
 *
 * Global CLI tool – run `browsermonitor` in any project directory.
 * Configuration in .browsermonitor/settings.json (created on first run).
 *
 * Subcommands:
 *   init         → Create .browsermonitor/, settings.json, update agent files
 *
 * Mode is chosen by arguments:
 *   (none)       → Interactive: menu (o = open, j = join, q = quit)
 *   --open       → Open mode: launch new Chrome and monitor
 *   --join=PORT  → Join mode: attach to existing Chrome at localhost:PORT
 *
 * Options:
 *   --realtime       Write logs immediately (default: lazy)
 *   --headless       Run in headless mode (default: GUI)
 *   --timeout=MS     Hard timeout in ms (default: disabled)
 *   --nav-timeout=MS Navigation timeout in ms (default: from settings)
 *   --help           Show help
 */

import { parseArgs } from 'node:util';
import { runJoinMode } from './monitor/join-mode.mjs';
import { runOpenMode } from './monitor/open-mode.mjs';
import { printAppIntro } from './intro.mjs';
import { createHttpServer } from './http-server.mjs';
import { printApiHelpTable } from './templates/api-help.mjs';
import { printCliCommandsTable } from './templates/cli-commands.mjs';
import { printModeHeading } from './templates/section-heading.mjs';
import { loadSettings, getPaths, ensureDirectories, isInitialized, DEFAULT_SETTINGS, saveSettings } from './settings.mjs';
import { runInit } from './init.mjs';
import { resolveHttpPort, resolveDefaultUrl, askMode } from './utils/ask.mjs';

// ---- Parse CLI arguments ----
const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    open:          { type: 'boolean', default: false },
    join:          { type: 'string' },
    port:          { type: 'string' },
    realtime:      { type: 'boolean', default: false },
    headless:      { type: 'boolean', default: false },
    timeout:       { type: 'string', default: '0' },
    'nav-timeout': { type: 'string' },
    help:          { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: false,
});

const subcommand = positionals[0];
const urlFromArgs = positionals.find((a) => /^https?:\/\//.test(a) || a.includes('localhost'));
const joinPort = flags.join ? parseInt(flags.join, 10) : null;
const httpPortFromArgs = flags.port ? parseInt(flags.port, 10) : null;
const hardTimeout = parseInt(flags.timeout, 10) || 0;

// Handle `browsermonitor init`
if (subcommand === 'init') {
  await runInit(process.cwd());
  process.exit(0);
}

// Show help
if (flags.help) {
  console.log(`
Browser Monitor – capture browser console, network, and DOM for debugging and LLM workflows.

What it does:
  Connects to Chrome (via Puppeteer) and records console output, network requests, cookies,
  and the current page HTML. Logs can be written to files on demand (lazy) or in real time.
  Useful for debugging frontend apps, E2E flows, and feeding context to AI assistants
  (e.g. read .browsermonitor/.puppeteer/dom.html for the live DOM).

`);
  printCliCommandsTable({ showEntry: true, showUsage: true });
  console.log(`
Subcommands:
  init                  Create .browsermonitor/, settings.json with defaults, update agent files

Modes (chosen by flags; only one applies):
  INTERACTIVE (default)   No flag. First run asks HTTP port and URL. Then menu:
                            o = open Chrome, j = join running Chrome, q = quit

  OPEN (--open)           Launch a new Chrome and monitor it. URL = first positional or config.

  JOIN (--join=PORT)      Attach to existing Chrome with remote debugging on PORT.
                          If PORT omitted, scans for running instances.

Options:
  --port=PORT             HTTP API port (default: from settings or 60001)
  --realtime              Write each event to files immediately (default: lazy)
  --headless              Run Chrome without GUI
  --timeout=MS            Hard timeout in ms; process exits after (0 = disabled)
  --nav-timeout=MS        Navigation timeout in ms (default: from settings)
  --help, -h              Show this help

Config (.browsermonitor/settings.json):
  defaultUrl, headless, navigationTimeout, ignorePatterns, httpPort, realtime

`);
  printApiHelpTable({ port: 60001, showApi: true, showInteractive: false, showOutputFiles: true });
  process.exit(0);
}

(async () => {
  // 1. Intro
  printAppIntro();

  // 2. Project root = cwd, load existing settings (may be empty/missing)
  const projectRoot = process.cwd();
  ensureDirectories(projectRoot);
  let config = loadSettings(projectRoot);
  const paths = getPaths(projectRoot);

  // 3. CLI args override settings.json
  const realtimeMode = flags.realtime || config.realtime;
  const navTimeoutFromArgs = flags['nav-timeout'] ? parseInt(flags['nav-timeout'], 10) : null;
  const navigationTimeout = navTimeoutFromArgs
    ?? (config.navigationTimeout !== undefined ? config.navigationTimeout : 60_000);
  const headless = flags.headless || config.headless || false;
  const httpPort = await resolveHttpPort(httpPortFromArgs ?? config.httpPort, DEFAULT_SETTINGS.httpPort);
  const url = await resolveDefaultUrl(urlFromArgs || config.defaultUrl, DEFAULT_SETTINGS.defaultUrl);
  
  // 4. Need to initialize project (create .browsermonitor/, settings.json) before showing API info, because API port is part of config
  if (!isInitialized(projectRoot)) {
    saveSettings(projectRoot, { ...DEFAULT_SETTINGS, httpPort, defaultUrl: url, headless, navigationTimeout, realtime: realtimeMode });
    config = loadSettings(projectRoot);
    await runInit(projectRoot, config);
  }

  // 5. Show API/output info (now httpPort is known)
  printApiHelpTable({
    url: config.defaultUrl,
    port: config.httpPort,
    showApi: true,
    showInteractive: false,
    showOutputFiles: true,
    noLeadingNewline: true,
    context: paths,
  });

  const sharedHttpState = {
    mode: 'interactive',
    logBuffer: null,
    getPages: () => [],
    getCollectingPaused: () => false,
    setCollectingPaused: () => {},
    switchToTab: async () => ({ success: false, error: 'No browser connected' }),
    getAllTabs: async () => [],
  };
  const sharedHttpServer = createHttpServer({
    port: config.httpPort,
    defaultPort: config.httpPort,
    getState: () => sharedHttpState,
  });

  const commonOptions = {
    outputDir: projectRoot,
    paths,
    realtime: realtimeMode,
    ignorePatterns: config.ignorePatterns,
    hardTimeout,
    httpPort: config.httpPort,
    joinPort,
    sharedHttpState,
    sharedHttpServer,
  };

  // 8. Dispatch to mode
  if (flags.open) {
    await runOpenMode(config.defaultUrl, {
      ...commonOptions,
      headless,
      navigationTimeout,
    });
  } else if (joinPort !== null) {
    await runJoinMode(config.defaultUrl, commonOptions);
  } else {
    // No mode flag → ask user
    printModeHeading('Choose mode');
    const mode = await askMode();
    if (mode === 'q') process.exit(0);

    if (mode === 'o') {
      await runOpenMode(config.defaultUrl, {
        ...commonOptions,
        headless,
        navigationTimeout,
        skipModeHeading: true,
      });
    } else if (mode === 'j') {
      await runJoinMode(config.defaultUrl, {
        ...commonOptions,
        skipModeHeading: true,
      });
    }
  }
})();
