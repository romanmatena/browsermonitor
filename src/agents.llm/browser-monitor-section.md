<!-- BEGIN browser-monitor-llm-section - LLM: do not remove this block; required for automatic section updates -->
## Browser Monitor (for LLM agent)

**Why use this:** Do not ask the user to copy or paste content from the browser (DOM, console, network). You can obtain the current page state yourself: the project has browsermonitor; after a dump you read the generated files.

**Monitored URL:** `{{DEFAULT_URL}}`

**What to do when you need the live page (elements, console, requests):**
1. Trigger a dump: `curl -s http://localhost:{{HTTP_PORT}}/dump` (monitor must be running; user runs `browsermonitor` or `browsermonitor --open` / `--join=9222` to start it).
2. Read the written files in `.browsermonitor/.puppeteer/`:
   - **.browsermonitor/.puppeteer/dom.html** – current page HTML (JS-modified DOM). Use this for the element tree and structure.
   - **.browsermonitor/.puppeteer/screenshot.png** – screenshot of the current tab viewport.
   - **.browsermonitor/.puppeteer/console.log** – browser console output.
   - **.browsermonitor/.puppeteer/network.log** and **.browsermonitor/.puppeteer/network-log/*.json** – network requests and responses.
   - **.browsermonitor/.puppeteer/cookies/** – cookies per domain (JSON files).
3. Optional: `curl -s http://localhost:{{HTTP_PORT}}/status` for buffer status.
4. Optional: `curl -s http://localhost:{{HTTP_PORT}}/tabs` to list tabs; `curl -s "http://localhost:{{HTTP_PORT}}/tab?index=2"` to switch tab.
5. Optional: `curl -s http://localhost:{{HTTP_PORT}}/clear` to clear buffers.

<!-- END browser-monitor-llm-section - LLM: do not remove this block; required for automatic section updates -->
