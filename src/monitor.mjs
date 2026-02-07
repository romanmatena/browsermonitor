/**
 * Browser Monitor - monitors browser console and network on dev server
 *
 * Modes:
 * - Default (lazy): Stores logs in memory, writes to file on demand
 *   Press 'd' to dump logs to files (auto-clears buffer after)
 *   Press 'c' to clear memory buffer
 *   Press 's' to show status
 *   Press 'k' to kill Chrome and exit
 *   Press 'q' to quit
 * - Realtime (--realtime): Writes every event immediately to files
 *
 * Features:
 * - Console output -> .browsermonitor/.puppeteer/console.log (filtered, with HMR detection)
 * - Network requests -> .browsermonitor/.puppeteer/network-log/ directory
 *   - .browsermonitor/.puppeteer/network.log - main log with request IDs
 *   - {id}.json - detailed request/response for each request
 * - DOM dump on /dump or key 'd' -> .browsermonitor/.puppeteer/dom.html (current JS-modified HTML structure)
 * - Console clear detection (clears buffer/log file)
 * - GUI browser mode (user can interact)
 * - HTTP API for LLM integration (default port 60001)
 *   - GET/POST /dump - Trigger dump of buffered logs
 *   - GET /status - Get current buffer status
 * - Proper cleanup on exit (SIGINT, SIGTERM, uncaughtException)
 */

// Re-export modes (implementations live in monitor/ to keep this file small)
export { runJoinMode } from './monitor/join-mode.mjs';
export { runOpenMode } from './monitor/open-mode.mjs';

/**
 * Run in Interactive Mode – delegates to monitor/interactive-mode.mjs with runOpenMode/runJoinMode to avoid circular deps.
 */
export async function runInteractiveMode(options = {}) {
  const { runInteractiveMode: runInteractive } = await import('./monitor/interactive-mode.mjs');
  const { runOpenMode } = await import('./monitor/open-mode.mjs');
  const { runJoinMode } = await import('./monitor/join-mode.mjs');
  return runInteractive(options, { runOpenMode, runJoinMode });
}
