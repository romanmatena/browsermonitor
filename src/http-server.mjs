/**
 * HTTP server for browsermonitor.
 *
 * Provides HTTP API endpoints for LLM/script integration:
 * - GET /dump - Trigger dump; writes files and returns paths + LLM-oriented description
 * - GET /status - Current monitor status
 * - GET /stop, GET /start - Pause/resume collecting
 * - POST /puppeteer - Generic Puppeteer method call: { "method": "page.goto", "args": ["https://..."] }
 */

import http from 'http';
import { C, log } from './utils/colors.mjs';
import { getFullTimestamp } from './logging/index.mjs';
import { getComputedStylesFromPage } from './logging/dump.mjs';
import { API_ENDPOINTS } from './templates/api-help.mjs';


/** Default timeout for Puppeteer operations (ms). */
const PUPPETEER_CALL_TIMEOUT_MS = 30_000;
/** Max request body size (bytes) for POST /puppeteer. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Allowed page.* methods for POST /puppeteer (no evaluate by default for safety). */
const PAGE_WHITELIST = new Set([
  'goto', 'click', 'type', 'focus', 'hover', 'select',
  'content', 'title', 'url',
  'screenshot', 'pdf',
  'setViewport', 'setDefaultTimeout', 'setDefaultNavigationTimeout',
  'waitForSelector', 'waitForTimeout',
]);

/**
 * Read request body as UTF-8 string with size limit.
 * @param {http.IncomingMessage} req
 * @param {number} [limitBytes=MAX_BODY_BYTES]
 * @returns {Promise<string>}
 */
function readBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const finishError = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };

    const finishOk = (text) => {
      if (done) return;
      done = true;
      resolve(text);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error(`Request body too large (max ${limitBytes} bytes)`);
        err.code = 'BODY_TOO_LARGE';
        try { req.destroy(err); } catch {}
        finishError(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finishOk(Buffer.concat(chunks).toString('utf8')));
    req.on('error', finishError);
  });
}

/**
 * Serialize Puppeteer method return value for JSON response.
 * @param {unknown} result
 * @param {string} methodName - e.g. 'goto'
 * @returns {{ serialized: unknown } | { error: string }}
 */
function serializeResult(result, methodName) {
  if (result === undefined) return { serialized: null };
  if (Buffer.isBuffer(result)) return { serialized: result.toString('base64') };
  if (result !== null && typeof result === 'object' && typeof result.url === 'function' && typeof result.status === 'function') {
    try {
      return { serialized: { url: result.url(), status: result.status() } };
    } catch {
      return { error: 'Failed to serialize response object' };
    }
  }
  try {
    JSON.stringify(result);
    return { serialized: result };
  } catch {
    return { error: 'Method returns non-serializable value' };
  }
}

/**
 * Create and start the HTTP server for monitor API.
 * Supports two modes:
 * - getState(): use a shared state object (for early start before open/join). State can have logBuffer null = no browser.
 * - Direct options (logBuffer, getPages, ...): classic per-mode server.
 *
 * @param {Object} options - Server options
 * @param {number} options.port - Port to listen on (default: 60001, 0 = disabled)
 * @param {string} options.host - Host to bind (default: 127.0.0.1)
 * @param {Function} [options.getState] - () => ({ mode, logBuffer, getPages, getCollectingPaused, setCollectingPaused }) for shared state
 * @param {string} [options.mode] - Monitor mode when not using getState
 * @param {Object} [options.logBuffer] - LogBuffer when not using getState
 * @param {Function} [options.getPages] - When not using getState
 * @param {Function} [options.getCollectingPaused] - When not using getState
 * @param {Function} [options.setCollectingPaused] - When not using getState
 * @param {Function} [options.onDump] - Optional callback when dump is requested
 * @param {number} [options.defaultPort=60001] - Default port; if port differs, "(changed)" is shown
 * @returns {http.Server|null} Server instance or null if port is 0
 */
export function createHttpServer(options) {
  const {
    port = 60001,
    host = '127.0.0.1',
    defaultPort = 60001,
    getState = null,
    mode = 'unknown',
    logBuffer,
    getPages = () => [],
    getCollectingPaused = () => false,
    setCollectingPaused = () => {},
    onDump = null,
  } = options;

  if (port === 0) {
    log.dim('HTTP server disabled (port 0)');
    return null;
  }

  function state() {
    if (getState) {
      const s = getState();
      return {
        mode: s.mode ?? 'interactive',
        logBuffer: s.logBuffer ?? null,
        getPages: s.getPages ?? (() => []),
        getCollectingPaused: s.getCollectingPaused ?? (() => false),
        setCollectingPaused: s.setCollectingPaused ?? (() => {}),
        switchToTab: s.switchToTab ?? (async () => ({ success: false, error: 'Not available' })),
        getAllTabs: s.getAllTabs ?? (async () => []),
      };
    }
    return {
      mode,
      logBuffer,
      getPages,
      getCollectingPaused,
      setCollectingPaused,
      switchToTab: async () => ({ success: false, error: 'Not available' }),
      getAllTabs: async () => [],
    };
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const s = state();
    const noBrowser = !s.logBuffer;

    // GET /dump
    if (req.url === '/dump' && req.method === 'GET') {
      if (noBrowser) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          state: s.mode,
          message: 'No browser connected. Choose open (o) or join (j) in interactive mode, or use --open / --join.',
          timestamp: getFullTimestamp(),
          endpoints: { status: 'GET /status', dump: 'GET /dump (after browser connected)' },
        }, null, 2));
        return;
      }
      try {
        const pages = s.getPages();
        const page = pages.length > 0 ? pages[0] : null;

        await s.logBuffer.dumpBuffersToFiles({
          dumpCookies: page ? () => s.logBuffer.dumpCookiesFromPage(page) : null,
          dumpDom: page ? () => s.logBuffer.dumpDomFromPage(page) : null,
          dumpScreenshot: page ? () => s.logBuffer.dumpScreenshotFromPage(page) : null,
        });

        if (onDump) onDump();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          timestamp: getFullTimestamp(),
          message: 'Dump completed. Read the files below.',
          files: [
            { path: s.logBuffer.DOM_HTML, what: 'Current page HTML (JS-modified DOM). Use for element tree and structure.' },
            { path: s.logBuffer.SCREENSHOT, what: 'Screenshot of the current tab viewport (PNG).' },
            { path: s.logBuffer.CONSOLE_LOG, what: 'Browser console output (logs, errors, warnings).' },
            { path: s.logBuffer.NETWORK_LOG, what: 'Network requests overview (one line per request with ID).' },
            { path: s.logBuffer.NETWORK_DIR, what: 'Directory with one JSON per request: full headers, payload, response (see IDs in network log).' },
            { path: s.logBuffer.COOKIES_DIR, what: 'Directory with cookies per domain (JSON files).' },
          ],
        }, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }, null, 2));
      }
      return;
    }

    // GET /status — state only (no file paths; use GET /dump for that)
    if (req.url === '/status' && req.method === 'GET') {
      const pages = s.getPages();
      const collectingPaused = s.getCollectingPaused();
      const payload = {
        status: noBrowser ? 'interactive' : 'running',
        mode: s.mode,
        timestamp: getFullTimestamp(),
        monitoredPages: noBrowser ? [] : pages.map(p => {
          try { return p.url(); } catch { return 'unknown'; }
        }),
      };
      if (!noBrowser) {
        payload.collecting = collectingPaused ? 'paused' : 'running';
        payload.stats = s.logBuffer.getStats();
      } else {
        payload.message = 'No browser. Use interactive (o/j) or --open / --join.';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    // GET /stop
    if (req.url === '/stop' && req.method === 'GET') {
      s.setCollectingPaused(true);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        collecting: 'paused',
        message: noBrowser ? 'No browser.' : 'Collecting stopped (paused). Use /start to resume.',
        timestamp: getFullTimestamp(),
      }, null, 2));
      return;
    }

    // GET /start
    if (req.url === '/start' && req.method === 'GET') {
      s.setCollectingPaused(false);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        collecting: 'running',
        message: noBrowser ? 'No browser.' : 'Collecting started (resumed).',
        timestamp: getFullTimestamp(),
      }, null, 2));
      return;
    }

    // GET /clear
    if (req.url === '/clear' && req.method === 'GET') {
      if (noBrowser) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'No browser connected.',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      s.logBuffer.clearAllBuffers();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: 'Buffers cleared.',
        timestamp: getFullTimestamp(),
      }, null, 2));
      return;
    }

    // GET /tabs - list all user tabs (for /tab?index=N)
    if (req.url === '/tabs' && req.method === 'GET') {
      if (noBrowser) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tabs: [], message: 'No browser connected.' }, null, 2));
        return;
      }
      try {
        const tabs = await s.getAllTabs();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tabs, timestamp: getFullTimestamp() }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }, null, 2));
      }
      return;
    }

    // GET /computed-styles?selector=...
    if (req.url?.startsWith('/computed-styles') && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const selector = urlObj.searchParams.get('selector') || 'body';
      if (noBrowser) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'No browser connected.',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      const pages = s.getPages();
      const page = pages.length > 0 ? pages[0] : null;
      if (!page) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'No monitored page.',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      try {
        const result = await getComputedStylesFromPage(page, selector);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: !result.error,
          selector,
          timestamp: getFullTimestamp(),
          ...result,
        }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          timestamp: getFullTimestamp(),
        }, null, 2));
      }
      return;
    }

    // GET /tab or /tab?index=1
    if (req.url?.startsWith('/tab') && req.url !== '/tabs' && req.method === 'GET') {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const indexParam = urlObj.searchParams.get('index');
      const index = indexParam ? parseInt(indexParam, 10) : NaN;
      if (!Number.isInteger(index) || index < 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Missing or invalid index. Use /tab?index=1 (1-based tab number).',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      try {
        const result = await s.switchToTab(index);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: result.success,
          url: result.url,
          error: result.error,
          timestamp: getFullTimestamp(),
        }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          timestamp: getFullTimestamp(),
        }, null, 2));
      }
      return;
    }

    // POST /puppeteer - generic Puppeteer page method call
    const pathname = req.url?.split('?')[0];
    if (pathname === '/puppeteer' && req.method === 'POST') {
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        const isTooLarge = e?.code === 'BODY_TOO_LARGE';
        const status = isTooLarge ? 413 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: isTooLarge ? 'Request body too large (max 5MB)' : 'Invalid JSON body',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      const method = body.method;
      const args = Array.isArray(body.args) ? body.args : [];
      const timeout = typeof body.timeout === 'number' ? body.timeout : PUPPETEER_CALL_TIMEOUT_MS;
      const waitFor = body.waitFor === true; // auto waitForSelector before click/hover
      if (typeof method !== 'string' || !method.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Missing or invalid "method" (e.g. "page.goto")',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      if (!method.startsWith('page.')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Only "page.*" methods are supported (e.g. "page.goto", "page.click")',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      const methodName = method.slice(5).trim();
      if (!methodName || !PAGE_WHITELIST.has(methodName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: `Method "${method}" not allowed. Whitelist: ${[...PAGE_WHITELIST].sort().join(', ')}`,
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      const pages = s.getPages();
      const page = pages.length > 0 ? pages[0] : null;
      if (noBrowser || !page) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'No browser or page connected. Use open/join mode first.',
          timestamp: getFullTimestamp(),
        }, null, 2));
        return;
      }
      let callArgs = args;
      if (methodName === 'screenshot') {
        const opts = (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]))
          ? { ...args[0], encoding: args[0].encoding ?? 'base64' }
          : { encoding: 'base64' };
        callArgs = [opts];
      }
      if (methodName === 'pdf' && args[0] && typeof args[0] === 'object') {
        callArgs = [{ ...args[0], encoding: args[0].encoding ?? 'base64' }];
      }
      try {
        // Auto waitForSelector before click/hover if requested
        if (waitFor && ['click', 'hover', 'focus', 'type'].includes(methodName) && callArgs[0]) {
          const selector = callArgs[0];
          if (typeof selector === 'string') {
            await page.waitForSelector(selector, { timeout });
          }
        }
        const fn = page[methodName];
        if (typeof fn !== 'function') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: `Page method "${methodName}" is not a function`,
            timestamp: getFullTimestamp(),
          }, null, 2));
          return;
        }
        const resultPromise = fn.apply(page, callArgs);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
        });
        const result = await Promise.race([resultPromise, timeoutPromise]);
        const serialized = serializeResult(result, methodName);
        if ('error' in serialized) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: serialized.error,
            timestamp: getFullTimestamp(),
          }, null, 2));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          result: serialized.serialized,
          timestamp: getFullTimestamp(),
        }, null, 2));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message || String(err),
          timestamp: getFullTimestamp(),
        }, null, 2));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      endpoints: API_ENDPOINTS.map(e => `${e.method} ${e.path} - ${e.description}`),
    }, null, 2));
  });

  server.listen(port, host);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.warn(`HTTP server port ${port} is already in use`);
    } else {
      log.error(`HTTP server error: ${err.message}`);
    }
  });

  return server;
}

/**
 * Close the HTTP server gracefully.
 * @param {http.Server} server - Server to close
 * @returns {Promise<void>}
 */
export function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
}
