/**
 * Single source of truth for HTTP API and output files reference.
 * Renders tables via cli-table3.
 */

import { C } from '../utils/colors.mjs';
import { printSectionHeading } from './section-heading.mjs';
import { createTable, printTable, INDENT } from './table-helper.mjs';
import { printInteractiveSection } from './interactive-keys.mjs';

// ─── Data (edit only here) ─────────────────────────────────────────────────

export const API_ENDPOINTS = [
  { method: 'GET', path: '/dump', description: 'Dump logs, DOM, cookies, screenshot to files; response has output paths' },
  { method: 'GET', path: '/status', description: 'Current status, monitored URLs, stats, output file paths' },
  { method: 'GET', path: '/stop', description: 'Pause collecting (console/network)' },
  { method: 'GET', path: '/start', description: 'Resume collecting' },
  { method: 'GET', path: '/clear', description: 'Clear in-memory buffers' },
  { method: 'GET', path: '/tabs', description: 'List all user tabs (index, url)' },
  { method: 'GET', path: '/tab?index=N', description: 'Switch monitored tab (1-based index)' },
  { method: 'GET', path: '/computed-styles?selector=...', description: 'Get computed CSS for first element matching selector (default: body)' },
  { method: 'POST', path: '/puppeteer', description: 'Call Puppeteer page method. Body: { "method": "page.goto", "args": ["https://..."] }. Whitelist: content, click, focus, goto, hover, pdf, screenshot, select, setDefaultNavigationTimeout, setDefaultTimeout, setViewport, title, type, url' },
];

export const OUTPUT_FILES = [
  { path: '.browsermonitor/.puppeteer/console.log', description: 'Browser console output' },
  { path: '.browsermonitor/.puppeteer/network.log', description: 'Network requests overview (IDs)' },
  { path: '.browsermonitor/.puppeteer/network-log/', description: 'Per-request JSON (headers, payload, response)' },
  { path: '.browsermonitor/.puppeteer/cookies/', description: 'Cookies per domain (JSON)' },
  { path: '.browsermonitor/.puppeteer/dom.html', description: 'Current page DOM (for LLM / structure)' },
  { path: '.browsermonitor/.puppeteer/screenshot.png', description: 'Screenshot of current tab viewport' },
];

/** Full description for API section. */
const API_DESCRIPTION =
  'For LLM Coding agents: Browser Monitor captures live browser state (console, network, DOM) and writes it to files. You or an LLM read those files instead of copy-pasting from DevTools. For debugging or feeding context to AI you need the real console, DOM, and traffic—this tool gives a one-command snapshot. Frontend devs and teams using LLM agents need it; without it, a reliable live-browser snapshot is much harder. Essential for E2E and for feeding DOM and network data to LLM agents.';

const API_USAGE =
  'Use curl to communicate with the HTTP API over REST. GET for status/dump/tabs etc.; POST for /puppeteer with JSON body. Example: curl http://127.0.0.1:60001/status  curl -X POST http://127.0.0.1:60001/puppeteer -H "Content-Type: application/json" -d \'{"method":"page.goto","args":["https://example.com"]}\'';

/**
 * Print HTTP API and output files as readable tables.
 * @param {Object} options
 * @param {number} [options.port=60001]
 * @param {string} [options.host='127.0.0.1']
 * @param {boolean} [options.showApi=true]
 * @param {boolean} [options.showInteractive=false] - Interactive help (keyboard shortcuts, human interaction)
 * @param {boolean} [options.showOutputFiles=true]
 * @param {Object} [options.context] - Override paths for session help: { consoleLog, networkLog, domHtml }
 * @param {Object} [options.sessionContext] - Full help only: { currentUrl, profilePath } – copy-paste for Claude Code
 * @param {boolean} [options.noLeadingNewline=false] - Skip blank line before first section (e.g. when right after CLI intro)
 */
export function printApiHelpTable(options = {}) {
  const {
    port = 60001,
    host = '127.0.0.1',
    showApi = true,
    showInteractive = false,
    showOutputFiles = true,
    context = null,
    sessionContext = null,
    noLeadingNewline = false,
  } = options;

  const baseUrl = `http://${host}:${port}`;

  if (showApi) {
    if (!noLeadingNewline) console.log('');
    printSectionHeading('HTTP API', INDENT);

    const hasSession = sessionContext && (sessionContext.currentUrl || sessionContext.profilePath);
    const apiTable = createTable({
      colWidths: hasSession ? [14, 82] : [14, 60],
      tableOpts: { wordWrap: true, maxWidth: hasSession ? 100 : 90 },
    });
    const methodsContent = API_ENDPOINTS.map(
      (r) => `${C.green}${r.method}${C.reset} ${C.brightCyan}${r.path}${C.reset} ${r.description}`
    ).join('\n');
    const urlLabel = sessionContext ? `${C.dim}HTTP API URL${C.reset}` : `${C.dim}Default URL${C.reset}`;

    const rows = [];
    if (sessionContext && (sessionContext.currentUrl || sessionContext.profilePath)) {
      const lines = [];
      if (sessionContext.currentUrl) {
        lines.push(`${C.dim}Monitored URL:${C.reset}\n${C.brightCyan}${sessionContext.currentUrl}${C.reset}`);
      }
      if (sessionContext.profilePath) {
        lines.push(`${C.dim}Chrome profile:${C.reset}\n${C.brightCyan}${sessionContext.profilePath}${C.reset}`);
      }
      rows.push([`${C.dim}Session${C.reset}`, lines.join('\n\n')]);
    }
    rows.push(
      [`${C.dim}Description${C.reset}`, API_DESCRIPTION],
      [`${C.dim}Usage${C.reset}`, API_USAGE],
      [urlLabel, `${C.brightCyan}${baseUrl}${C.reset}`],
      [`${C.dim}Methods${C.reset}`, methodsContent]
    );
    rows.forEach((r) => apiTable.push(r));
    printTable(apiTable);
  }

  if (showOutputFiles) {
    const files = context
      ? [
          { path: context.consoleLog, description: 'Console log' },
          { path: context.networkLog, description: 'Network log' },
          { path: context.networkDir, description: 'Per-request JSON (headers, payload, response)' },
          { path: context.cookiesDir, description: 'Cookies per domain (JSON)' },
          { path: context.domHtml, description: 'Current page DOM (LLM)' },
          { path: context.screenshot, description: 'Screenshot of current tab' },
        ]
      : OUTPUT_FILES;

    console.log('');
    printSectionHeading('Output files', INDENT);
    if (context) {
      console.log(`${INDENT}${C.dim}(this run)${C.reset}`);
    }
    const content = files
      .map((f) => `${C.dim}${f.description}${C.reset}\n${C.brightCyan}${f.path}${C.reset}`)
      .join('\n\n');
    const ofTable = createTable({
      colWidths: [74],
      tableOpts: { wordWrap: true, maxWidth: 80 },
    });
    ofTable.push([content]);
    printTable(ofTable);
  }

  if (showInteractive) {
    printInteractiveSection();
  }

  // Same info without tables, structured for LLM (no box-drawing / table chars; no keyboard shortcuts)
  if (showApi || showOutputFiles) {
    printApiHelpForLlm({ port, host, showApi, showOutputFiles, context, sessionContext });
  }

  console.log('');
}

/**
 * Print API, output files and keys in plain structured text for LLM consumption (no tables).
 * Same data as printApiHelpTable, format optimized for parsing by LLM.
 */
function printApiHelpForLlm(options = {}) {
  const {
    port = 60001,
    host = '127.0.0.1',
    showApi = true,
    showOutputFiles = true,
    context = null,
    sessionContext = null,
  } = options;

  const baseUrl = `http://${host}:${port}`;
  const files = context
    ? [
        { path: context.consoleLog, description: 'Console log' },
        { path: context.networkLog, description: 'Network log' },
        { path: context.networkDir, description: 'Per-request JSON (headers, payload, response)' },
        { path: context.cookiesDir, description: 'Cookies per domain (JSON)' },
        { path: context.domHtml, description: 'Current page DOM (LLM)' },
        { path: context.screenshot, description: 'Screenshot of current tab' },
      ]
    : OUTPUT_FILES;

  console.log('');
  console.log('--- LLM reference (plain text, no tables) ---');
  console.log('');
  console.log('Base URL: ' + baseUrl);
  if (sessionContext?.currentUrl) {
    console.log('Monitored URL: ' + sessionContext.currentUrl);
  }
  if (sessionContext?.profilePath) {
    console.log('Chrome profile path: ' + sessionContext.profilePath);
  }
  if (sessionContext?.currentUrl || sessionContext?.profilePath) {
    console.log('');
  }

  if (showApi) {
    console.log('HTTP API endpoints:');
    for (const e of API_ENDPOINTS) {
      console.log('  ' + e.method + ' ' + e.path);
      console.log('    ' + e.description);
    }
    console.log('');
  }

  if (showOutputFiles) {
    console.log('Output files (paths and purpose):');
    for (const f of files) {
      console.log('  ' + f.path);
      console.log('    ' + f.description);
    }
    console.log('');
  }

  console.log('--- end LLM reference ---');
  console.log('');
}

/**
 * One-line API hint (for Ready bar and intro).
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 */
export function apiHintOneLine(port, host = '127.0.0.1') {
  const base = `http://${host}:${port}`;
  return `${C.dim}curl ${base}/dump  ${base}/status  ${base}/stop  ${base}/start${C.reset}`;
}
