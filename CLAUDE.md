## Browser Monitor

Global CLI tool to monitor browser console and network requests while debugging. Modes:
- **Interactive** – menu (o = open, j = join, q = quit)
- **Open** – launch new Chrome via Puppeteer
- **Join** – attach to existing Chrome with remote debugging

### Usage

```bash
# INTERACTIVE - Menu
browsermonitor

# OPEN - Launch new Chrome
browsermonitor --open
browsermonitor --open https://myapp.example.com/
browsermonitor --open --headless
browsermonitor --open --realtime

# JOIN - Attach to existing Chrome
browsermonitor --join=9222

# INIT - Re-run setup
browsermonitor init
```

### Modes

- **Lazy (default)** - Buffers logs in memory, writes to files on demand with hotkeys
- **Realtime (`--realtime`)** - Writes every event immediately to files

### Keyboard Controls (Lazy Mode)

| Key | Action | Description |
|-----|--------|-------------|
| `d` | dump | Write logs, DOM, cookies, screenshot to files |
| `c` | clear | Clear memory buffer |
| `s` | status | Show buffer counts, URLs |
| `p` | pause/resume | Pause or resume recording |
| `t` | tab | Switch monitored tab |
| `h` | help | Full help (incl. HTTP API for LLM) |
| `k` | kill | Kill Chrome and exit [open] / kill Chrome and quit [join] |
| `q` | quit | Quit (Chrome stays open) [open] / disconnect only [join] |

### Output Files

All files are created in `.browsermonitor/.puppeteer/` under the project root:

- `.browsermonitor/.puppeteer/console.log` - Console output (filtered, with HMR markers)
- `.browsermonitor/.puppeteer/network.log` - Network requests overview with request IDs
- `.browsermonitor/.puppeteer/network-log/` - Directory with detailed request files:
  - `{id}.json` - Full details (headers, payload, response) for each request
- `.browsermonitor/.puppeteer/cookies/` - Directory with cookie files (per domain):
  - `{domain}.json` - Cookies for specific domain
- `.browsermonitor/.puppeteer/dom.html` - **Current page HTML (JS-modified element tree).** Written on each dump (key `d` or `curl …/dump`). Use this to read the live DOM structure (e.g. for LLM or debugging).
- `.browsermonitor/.puppeteer/screenshot.png` - Screenshot of the current tab viewport (on dump).

### Workflow

1. Start monitor: `browsermonitor`
2. Press `c` to clear buffer (remove startup noise)
3. Interact with the application in the browser
4. Press `s` to check buffer status
5. Press `d` to dump logs (and DOM) to files
6. Read `.browsermonitor/.puppeteer/console.log` for console output
7. Read `.browsermonitor/.puppeteer/network.log` for request overview
8. Check `.browsermonitor/.puppeteer/network-log/{id}.json` for specific request details
9. Read `.browsermonitor/.puppeteer/dom.html` for current page structure (elements).

### Features

- **Persistent session** - Browser profile saved in `.browsermonitor-profile/` (native) or `%LOCALAPPDATA%\browsermonitor\` (WSL), no re-login needed
- **Noise filtering** - Ignores IndexedDB, BackendSync, heartbeat logs
- **HMR detection** - Clear markers when code changes via Hot Module Replacement
- **Console clear** - Type `console.clear()` in browser to reset console buffer
- **Full request details** - Headers, payload, response body in JSON files
- **All cookies** - Dumps cookies from all domains via CDP (including HttpOnly)
- **DOM dump** - On each dump (key `d` or `curl …/dump`), current page HTML is saved to `.browsermonitor/.puppeteer/dom.html` (JS-modified element tree for LLM/debugging).
- **HTTP API** - `curl http://localhost:60001/dump`, `/status`, `/clear`, `/tabs`, `/tab?index=N`

---

## Join Mode (Remote / Existing Chrome)

Join mode attaches to an existing Chrome with `--remote-debugging-port=9222`. Use when:
- Chrome already runs on your machine
- Remote dev: SSH reverse tunnel `ssh -R 9222:localhost:9222 server`, Chrome on local PC

**Start Chrome manually** (local PC), then from monitor machine:

```bash
browsermonitor --join=9222
```

### Interactive Tab Selection

When you connect, browsermonitor shows all open tabs and lets you choose:

```
[Monitor] Found 3 open tab(s):

   1. Google                    https://google.com
   2. CADCloud - Projects       https://cadcloud.24gatel.eu/projects
   3. GitHub                    https://github.com

   a. Monitor ALL tabs
   q. Quit

Select tab to monitor (1-3, a=all, q=quit): 2

[Monitor] Monitoring: CADCloud - Projects
```

### Tips

- Chrome must be started with `--remote-debugging-port` flag BEFORE opening any tabs
- If Chrome is already running, you need to close it completely and restart with the flag
- The SSH tunnel must stay open for the connection to work
- You can monitor multiple tabs by selecting 'a' (all)
- Your browser session, cookies, and login state are preserved
