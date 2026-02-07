/**
 * WSL2 to Windows connection diagnostics.
 *
 * Comprehensive diagnostics for troubleshooting Chrome DevTools connectivity
 * from WSL2 to Windows. Checks all layers: Chrome process, port listening,
 * firewall rules, port proxy, and actual network connectivity.
 */

import { execSync, spawn } from 'child_process';
import { C } from '../../utils/colors.mjs';

/**
 * Run PowerShell command and return result.
 * @param {string} cmd - PowerShell command
 * @param {number} timeout - Timeout in ms
 * @returns {string|null} Command output or null on error
 */
function runPowerShell(cmd, timeout = 5000) {
  try {
    return execSync(`powershell.exe -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, { encoding: 'utf8', timeout }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Print prominent notice that UAC will appear on Windows (so user knows the script is not stuck).
 */
function printUacNotice() {
  console.log('');
  console.log(`${C.bgMagenta}${C.bold}${C.white}                                                                               ${C.reset}`);
  console.log(`${C.bgMagenta}${C.bold}${C.white}  ON WINDOWS: A UAC dialog will appear – click "Yes" to allow the fix.            ${C.reset}`);
  console.log(`${C.bgMagenta}${C.bold}${C.white}  This window will wait up to 60 s. If you cancel UAC, manual steps will be shown. ${C.reset}`);
  console.log(`${C.bgMagenta}${C.bold}${C.white}                                                                               ${C.reset}`);
  console.log('');
  console.log(`  ${C.magenta}Waiting for UAC approval on Windows...${C.reset}`);
  console.log(`  ${C.dim}(Still waiting? Look for the UAC window on Windows. Timeout 60 s.)${C.reset}`);
}

/**
 * Run PowerShell command with elevation (UAC prompt on Windows).
 * From WSL we have no admin rights; this opens an elevated PowerShell window so the user can approve.
 * Prints "Still waiting..." every 15 s so the terminal doesn't look stuck.
 * @param {string} innerCmd - PowerShell command to run as admin (e.g. Set-NetFirewallRule ...)
 * @param {number} timeout - Timeout in ms (elevated window can wait for user)
 * @param {boolean} silent - If true, do not print UAC notice (caller prints it)
 * @returns {boolean} true if the elevated process exited with code 0
 */
function runPowerShellElevated(innerCmd, timeout = 60000, silent = false) {
  if (!silent) {
    printUacNotice();
  }
  const innerEscaped = innerCmd.replace(/'/g, "''");
  const outerCmd = `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','${innerEscaped}' -Wait -PassThru | ForEach-Object { exit $_.ExitCode }`;
  const stillWaitingInterval = 15000;

  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', outerCmd], {
      windowsHide: true,
    });
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(interval);
      try { child.kill('SIGTERM'); } catch (_) {}
      console.log(`  ${C.yellow}Timeout (60 s) – use manual steps below.${C.reset}`);
      resolve(false);
    }, timeout);
    const interval = setInterval(() => {
      if (resolved) return;
      console.log(`  ${C.dim}Still waiting for UAC / elevated command...${C.reset}`);
    }, stillWaitingInterval);
    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      clearInterval(interval);
      resolve(code === 0);
    });
    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      clearInterval(interval);
      resolve(false);
    });
  });
}

/**
 * Run command and return result.
 * @param {string} cmd - Shell command
 * @param {number} timeout - Timeout in ms
 * @returns {string|null} Command output or null on error
 */
function runCmd(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Comprehensive WSL2 to Windows connection diagnostics.
 * Checks all layers: Chrome process, port listening, firewall rules, port proxy, WSL reachability.
 *
 * @param {number} port - Chrome debugging port
 * @param {string} windowsHostIP - Windows host IP from WSL perspective
 * @returns {Promise<{issues: Array<{level: string, message: string, fix?: string}>, canConnect: boolean, hasPortProxyConflict?: boolean, actualPort?: number}>}
 */
export async function runWslDiagnostics(port, windowsHostIP) {
  const issues = [];
  let canConnect = false;

  console.log('');
  console.log(`${C.bold}${C.cyan}╔═══════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}WSL2 → Windows Connection Diagnostics${C.reset}                                   ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚═══════════════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 1: Enumerate ALL Chrome debug instances
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`${C.bold}[1/7]${C.reset} Scanning Chrome instances on Windows...`);

  const chromePid = runPowerShell('Get-Process chrome -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { \\$_.Id }');

  if (!chromePid) {
    console.log(`  ${C.red}✗${C.reset} Chrome is NOT running on Windows`);
    issues.push({
      level: 'error',
      message: 'Chrome is not running on Windows',
      fix: 'Start Chrome with remote debugging:\n' +
           `     chrome.exe --remote-debugging-port=${port}\n` +
           `     Note: Port proxy is required for WSL access (Chrome M113+ binds to 127.0.0.1 only)`
    });
    return { issues, canConnect: false };
  }

  // Find all Chrome instances with debug ports (deduplicated by port)
  const wmicAll = runCmd('wmic.exe process where "name=\'chrome.exe\'" get commandline /format:list 2>nul');
  const debugInstances = [];
  const seenPorts = new Set();

  if (wmicAll) {
    const lines = wmicAll.split('\n').filter(l => l.includes('--remote-debugging-port'));
    for (const line of lines) {
      const portMatch = line.match(/--remote-debugging-port=(\d+)/);
      const addressMatch = line.match(/--remote-debugging-address=([^\s'"]+)/);
      const userDataMatch = line.match(/--user-data-dir=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
      if (portMatch) {
        const portNum = parseInt(portMatch[1], 10);
        if (!seenPorts.has(portNum)) {
          seenPorts.add(portNum);
          const userDataDir = userDataMatch ? (userDataMatch[1] || userDataMatch[2] || userDataMatch[3]) : 'default';
          debugInstances.push({
            port: portNum,
            bindAddress: addressMatch ? addressMatch[1] : '127.0.0.1',
            userDataDir,
          });
        }
      }
    }
  }

  console.log(`  ${C.green}✓${C.reset} Chrome is running`);

  if (debugInstances.length === 0) {
    console.log(`  ${C.red}✗${C.reset} No Chrome instances with --remote-debugging-port found`);
    issues.push({
      level: 'error',
      message: 'Chrome is running but without remote debugging enabled',
      fix: `${C.bold}Close ALL Chrome windows${C.reset} and let browsermonitor start a fresh instance.`
    });
    return { issues, canConnect: false };
  }

  console.log(`  ${C.cyan}Found ${debugInstances.length} Chrome instance(s) with debug port:${C.reset}`);
  for (const inst of debugInstances) {
    const bindOk = inst.bindAddress === '0.0.0.0';
    const bindIcon = bindOk ? C.green + '✓' : C.yellow + '!';
    const profileShort = inst.userDataDir.length > 50 ? '...' + inst.userDataDir.slice(-47) : inst.userDataDir;
    console.log(`    ${bindIcon}${C.reset} Port ${C.brightYellow}${inst.port}${C.reset} → ${bindOk ? C.green : C.yellow}${inst.bindAddress}${C.reset}`);
    console.log(`      ${C.dim}Profile: ${profileShort}${C.reset}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 2: Check actual network bindings
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}[2/7]${C.reset} Checking actual network bindings...`);

  let portProxyConflict = false;

  for (const inst of debugInstances) {
    const netstatOutput = runCmd(`netstat.exe -ano 2>/dev/null | grep -E ":${inst.port}.*LISTEN"`);
    const listeners = [];

    if (netstatOutput) {
      const lines = netstatOutput.split('\n').filter(l => l.includes('LISTEN'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const localAddr = parts[1];
          const pid = parts[4];
          const addrOnly = localAddr.replace(`:${inst.port}`, '').replace('[', '').replace(']', '');
          listeners.push({ address: addrOnly, pid, raw: localAddr });
        }
      }
    }

    const ipv4All = listeners.find(l => l.address === '0.0.0.0');
    const ipv6All = listeners.find(l => l.address === '::');
    const ipv4Local = listeners.find(l => l.address === '127.0.0.1');
    const ipv6Local = listeners.find(l => l.address === '::1');

    // Detect port proxy conflict
    if (inst.bindAddress === '0.0.0.0' && ipv4All && ipv6Local && !ipv4Local) {
      const ipv4Process = runCmd(`wmic.exe process where "processid=${ipv4All.pid}" get name 2>nul`);
      if (ipv4Process && ipv4Process.toLowerCase().includes('svchost')) {
        portProxyConflict = true;
        console.log(`  ${C.red}✗${C.reset} ${C.bold}PORT PROXY CONFLICT DETECTED!${C.reset}`);
        console.log(`    ${C.dim}Port proxy (svchost PID ${ipv4All.pid}) grabbed 0.0.0.0:${inst.port}${C.reset}`);
        console.log(`    ${C.dim}Chrome fell back to [::1]:${inst.port} (IPv6 localhost only)${C.reset}`);
        console.log(`    ${C.dim}Port proxy forwards to 127.0.0.1:${inst.port} but Chrome is on [::1]!${C.reset}`);
        inst.accessible = false;
        inst.portProxyConflict = true;
        issues.push({
          level: 'error',
          message: 'Port proxy conflict: Chrome on IPv6 [::1], port proxy expects IPv4 127.0.0.1',
          fix: `Remove port proxy, then restart browsermonitor Chrome ONLY:\n` +
               `     ${C.cyan}netsh interface portproxy delete v4tov4 listenport=${inst.port} listenaddress=0.0.0.0${C.reset}\n` +
               `     ${C.cyan}Get-WmiObject Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match 'browsermonitor' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }${C.reset}\n` +
               `     Then run browsermonitor again.`
        });
        continue;
      }
    }

    const listenOnAll = ipv4All || ipv6All;
    const listenLocal = ipv4Local || ipv6Local;

    if (listenOnAll && !portProxyConflict) {
      console.log(`  ${C.green}✓${C.reset} Port ${inst.port} listening on ${C.green}0.0.0.0${C.reset} (accessible from WSL)`);
      inst.accessible = true;
    } else if (listenLocal) {
      const addr = ipv4Local ? '127.0.0.1' : '[::1]';
      console.log(`  ${C.yellow}!${C.reset} Port ${inst.port} listening on ${C.yellow}${addr} only${C.reset} (NOT accessible from WSL)`);
      inst.accessible = false;
      issues.push({
        level: 'warn',
        message: `Chrome on port ${inst.port} is bound to localhost only (expected behavior)`,
        fix: `Port proxy is required for WSL access:\n` +
             `     netsh interface portproxy add v4tov4 listenport=${inst.port} listenaddress=0.0.0.0 connectport=${inst.port} connectaddress=127.0.0.1`
      });
    } else if (listeners.length > 0) {
      console.log(`  ${C.dim}○${C.reset} Port ${inst.port} - addresses: ${listeners.map(l => l.address).join(', ')}`);
      inst.accessible = false;
    } else {
      console.log(`  ${C.yellow}?${C.reset} Port ${inst.port} - could not determine bind address`);
      inst.accessible = false;
    }
  }

  // Find the best instance to use
  const accessibleInstances = debugInstances.filter(i => i.accessible);
  const matchingPort = debugInstances.find(i => i.port === port);
  const targetInstance = accessibleInstances.length > 0 ? accessibleInstances[0] :
                         matchingPort ? matchingPort : debugInstances[0];

  let actualPort = targetInstance.port;

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 3: Port configuration analysis
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}[3/7]${C.reset} Port configuration analysis...`);

  if (actualPort !== port) {
    console.log(`  ${C.red}!${C.reset} ${C.bold}PORT MISMATCH:${C.reset} We requested port ${port}, but Chrome uses ${actualPort}`);
    console.log(`  ${C.yellow}   → This means Chrome joined an EXISTING instance (singleton behavior)${C.reset}`);
    issues.push({
      level: 'error',
      message: `Chrome singleton issue: requested port ${port}, but existing Chrome uses ${actualPort}`,
      fix: `${C.bold}Close ALL Chrome windows${C.reset} and run browsermonitor again.\n` +
           `     Or use connect mode: browsermonitor --join=${actualPort}`
    });
  } else {
    console.log(`  ${C.green}✓${C.reset} Port matches: requested ${port}, Chrome uses ${actualPort}`);
  }

  if (targetInstance.bindAddress === '0.0.0.0') {
    console.log(`  ${C.green}✓${C.reset} Chrome accessible via 0.0.0.0 (port proxy active or legacy Chrome)`);
  } else {
    console.log(`  ${C.cyan}ℹ${C.reset} Chrome binds to 127.0.0.1 only (expected - Chrome M113+ security)`);
    console.log(`  ${C.cyan}   → Port proxy is required for WSL access${C.reset}`);
    issues.push({
      level: 'info',
      message: 'Chrome binds to 127.0.0.1 (normal behavior since Chrome M113)',
      fix: `Port proxy is required for WSL access:\n` +
           `     netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1`
    });
  }

  const isListeningOnAll = targetInstance.accessible;
  const isListeningOnLocalhost = !targetInstance.accessible && debugInstances.length > 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 4: Check Windows Firewall rules
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}[4/7]${C.reset} Checking Windows Firewall rules...`);

  const firewallStatus = runPowerShell('(Get-NetFirewallProfile -Profile Domain,Public,Private | Where-Object {\\$_.Enabled -eq \\$true}).Count');
  const enabledProfiles = parseInt(firewallStatus, 10) || 0;
  let firewallRuleOk = false;
  let existingRuleName = null;

  if (enabledProfiles === 0) {
    console.log(`  ${C.dim}○${C.reset} Windows Firewall is disabled (no rule needed)`);
    firewallRuleOk = true;
  } else {
    const firewallRulesJson = runPowerShell(`
      \\$rules = Get-NetFirewallRule -Direction Inbound -Action Allow -ErrorAction SilentlyContinue | Where-Object { \\$_.Enabled -eq 'True' }
      \\$matching = @()
      foreach (\\$rule in \\$rules) {
        \\$port = \\$rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        if (\\$port.LocalPort -match '${actualPort}' -or \\$port.LocalPort -match '9222-9299' -or \\$port.LocalPort -eq 'Any') {
          \\$addr = \\$rule | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
          \\$matching += @{
            Name = \\$rule.DisplayName
            LocalPort = \\$port.LocalPort
            RemoteAddress = \\$addr.RemoteAddress
          }
        }
      }
      \\$matching | ConvertTo-Json
    `);

    let existingRules = [];
    try {
      const parsed = JSON.parse(firewallRulesJson || '[]');
      existingRules = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch { }

    if (existingRules.length > 0) {
      const rule = existingRules[0];
      existingRuleName = rule.Name;
      const remoteAddr = String(rule.RemoteAddress || 'Any').toLowerCase();
      const allowsAny = remoteAddr === 'any' || remoteAddr === '*';
      const allowsWsl = remoteAddr.includes('172.') || remoteAddr.includes('localsubnet');

      if (allowsAny) {
        console.log(`  ${C.green}✓${C.reset} Firewall rule "${rule.Name}" allows any remote address`);
        firewallRuleOk = true;
      } else if (allowsWsl) {
        console.log(`  ${C.green}✓${C.reset} Firewall rule "${rule.Name}" allows WSL subnet`);
        console.log(`  ${C.dim}   RemoteAddress: ${rule.RemoteAddress}${C.reset}`);
        firewallRuleOk = true;
      } else {
        console.log(`  ${C.yellow}!${C.reset} Firewall rule "${rule.Name}" exists but may not allow WSL`);
        console.log(`  ${C.dim}   RemoteAddress: ${rule.RemoteAddress}${C.reset}`);
        console.log(`  ${C.dim}   WSL2 uses 172.x.x.x range which may not be covered${C.reset}`);
        issues.push({
          level: 'warn',
          message: `Firewall rule exists but RemoteAddress (${rule.RemoteAddress}) may not include WSL subnet`,
          fix: 'Update the rule to include WSL subnet:\n' +
               `     ${C.cyan}Set-NetFirewallRule -DisplayName "${rule.Name}" -RemoteAddress LocalSubnet,172.16.0.0/12${C.reset}\n` +
               '     Or create a new rule (see below)'
        });
      }
    } else {
      console.log(`  ${C.red}✗${C.reset} No firewall rule found for port ${actualPort}`);
      issues.push({
        level: 'error',
        message: 'Windows Firewall is blocking incoming connections',
        fix: 'Run in PowerShell (Admin):\n' +
             `     ${C.cyan}New-NetFirewallRule -DisplayName "Chrome Debug (browsermonitor)" -Direction Inbound -LocalPort 9222-9299 -Protocol TCP -Action Allow -RemoteAddress LocalSubnet,172.16.0.0/12${C.reset}`
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 5: Check port proxy configuration
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}[5/7]${C.reset} Checking port proxy configuration...`);

  const portProxy = runPowerShell('netsh interface portproxy show v4tov4');
  const hasPortProxy = portProxy && portProxy.includes(String(actualPort));

  if (isListeningOnAll) {
    console.log(`  ${C.dim}○${C.reset} Port proxy not needed (Chrome bound to 0.0.0.0)`);
  } else if (hasPortProxy) {
    console.log(`  ${C.green}✓${C.reset} Port proxy is configured for port ${actualPort}`);
    const proxyLines = portProxy.split('\n').filter(l => l.includes(String(actualPort)));
    for (const line of proxyLines) {
      console.log(`  ${C.dim}   ${line.trim()}${C.reset}`);
    }
  } else if (isListeningOnLocalhost) {
    console.log(`  ${C.yellow}!${C.reset} Port proxy NOT configured (needed for localhost-bound Chrome)`);
    issues.push({
      level: 'warn',
      message: 'Port proxy needed for localhost-bound Chrome',
      fix: 'Run in PowerShell (Admin):\n' +
           `     ${C.cyan}netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1${C.reset}\n` +
           '     To remove later:\n' +
           `     ${C.dim}netsh interface portproxy delete v4tov4 listenport=${actualPort} listenaddress=0.0.0.0${C.reset}`
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 6: Show existing port proxy rules for debug port range
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}[6/7]${C.reset} Existing port proxy rules (9222-9299 range)...`);

  if (portProxy) {
    const debugProxyLines = portProxy.split('\n').filter(l => {
      const portMatch = l.match(/(\d{4,5})/);
      if (portMatch) {
        const p = parseInt(portMatch[1], 10);
        return p >= 9222 && p <= 9299;
      }
      return false;
    });
    if (debugProxyLines.length > 0) {
      for (const line of debugProxyLines) {
        console.log(`  ${C.cyan}→${C.reset} ${line.trim()}`);
      }
    } else {
      console.log(`  ${C.dim}○${C.reset} No port proxy rules in debug port range`);
    }
  } else {
    console.log(`  ${C.dim}○${C.reset} Could not query port proxy configuration`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 7: Test actual connectivity from WSL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}[7/7]${C.reset} Testing connectivity from WSL to ${windowsHostIP}:${actualPort}...`);

  try {
    const response = await fetch(`http://${windowsHostIP}:${actualPort}/json/version`, {
      signal: AbortSignal.timeout(3000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`  ${C.green}✓${C.reset} Connection successful!`);
      console.log(`  ${C.dim}   Browser: ${data.Browser || 'Chrome'}${C.reset}`);
      canConnect = true;
    } else {
      console.log(`  ${C.red}✗${C.reset} HTTP ${response.status} - unexpected response`);
    }
  } catch (fetchErr) {
    const errMsg = fetchErr.message || 'unknown';

    if (errMsg.includes('ECONNREFUSED')) {
      console.log(`  ${C.red}✗${C.reset} Connection refused`);
      const proxyIssue = {
        level: 'error',
        message: 'Connection refused from WSL',
        fix: 'Chrome is not accepting connections on this IP. Port proxy may be missing.'
      };
      issues.push(proxyIssue);

      if (!hasPortProxy && isListeningOnLocalhost) {
        console.log('');
        console.log(`${C.bold}[Auto-fix]${C.reset} Adding port proxy...`);
        const proxyCmd = `netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1`;
        let proxyOk = runPowerShell(proxyCmd, 5000) !== null;
        if (!proxyOk) {
          proxyOk = await runPowerShellElevated(proxyCmd, 60000);
        }
        if (proxyOk) {
          console.log(`  ${C.green}✓${C.reset} Port proxy configured for ${actualPort}`);
          try {
            const retryResponse = await fetch(`http://${windowsHostIP}:${actualPort}/json/version`, { signal: AbortSignal.timeout(5000) });
            if (retryResponse.ok) {
              canConnect = true;
              console.log(`  ${C.green}✓${C.reset} Connection successful after port proxy.`);
              issues.pop();
            }
          } catch (_) {
            console.log(`  ${C.dim}Re-run the monitor.${C.reset}`);
          }
        } else {
          console.log(`  ${C.yellow}!${C.reset} Could not add port proxy (run PowerShell as Admin).`);
          proxyIssue.fix += '\n     Run in PowerShell (Admin):\n' +
            `     netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1`;
        }
      } else {
        proxyIssue.fix += '\n     (Chrome M113+ always binds to 127.0.0.1 - port proxy is required)';
      }
    } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout')) {
      console.log(`  ${C.red}✗${C.reset} Connection timeout (firewall blocking)`);
      const firewallIssue = {
        level: 'error',
        message: 'Connection timeout - firewall is blocking WSL',
        fix: 'Windows Firewall is blocking connections from WSL subnet.'
      };
      issues.push(firewallIssue);

      // Auto-fix: try to add/update firewall rule from WSL (may need Admin PowerShell if this fails)
      const ruleName = 'Chrome Debug (browsermonitor)';
      const ruleExists = runPowerShell(`Get-NetFirewallRule -DisplayName '${ruleName}' -ErrorAction SilentlyContinue | Select-Object -First 1`);
      const hasRule = ruleExists && ruleExists.trim().length > 0;

      console.log('');
      console.log(`${C.bold}[Auto-fix]${C.reset} Applying firewall rule for WSL...`);

      let fixOk = false;
      const setCmd = `Set-NetFirewallRule -DisplayName '${ruleName}' -RemoteAddress LocalSubnet,172.16.0.0/12 -ErrorAction Stop`;
      const newCmd = `New-NetFirewallRule -DisplayName '${ruleName}' -Direction Inbound -LocalPort 9222-9299 -Protocol TCP -Action Allow -RemoteAddress LocalSubnet,172.16.0.0/12 -ErrorAction Stop`;
      if (hasRule) {
        fixOk = runPowerShell(setCmd, 8000) !== null;
        if (!fixOk) {
          fixOk = await runPowerShellElevated(setCmd, 60000);
        }
        if (fixOk) {
          console.log(`  ${C.green}✓${C.reset} Updated existing rule "${ruleName}" to allow WSL subnet`);
        } else {
          console.log(`  ${C.yellow}!${C.reset} Could not update rule (try PowerShell as Admin)`);
        }
      } else {
        fixOk = runPowerShell(newCmd, 8000) !== null;
        if (!fixOk) {
          fixOk = await runPowerShellElevated(newCmd, 60000);
        }
        if (fixOk) {
          console.log(`  ${C.green}✓${C.reset} Created firewall rule "${ruleName}"`);
        } else {
          console.log(`  ${C.yellow}!${C.reset} Could not create rule (try PowerShell as Admin)`);
        }
      }

      if (fixOk) {
        console.log(`  ${C.dim}Re-testing connectivity...${C.reset}`);
        try {
          const retryResponse = await fetch(`http://${windowsHostIP}:${actualPort}/json/version`, {
            signal: AbortSignal.timeout(5000)
          });
          if (retryResponse.ok) {
            canConnect = true;
            console.log(`  ${C.green}✓${C.reset} Connection successful after firewall fix.`);
            issues.pop(); // remove firewall issue so summary is clean
          }
        } catch (_) {
          console.log(`  ${C.dim}Still unreachable - wait a few seconds and run the monitor again.${C.reset}`);
        }
      } else {
        firewallIssue.fix += '\n     Run in PowerShell as Administrator:\n' +
          `     Set-NetFirewallRule -DisplayName "${ruleName}" -RemoteAddress LocalSubnet,172.16.0.0/12\n` +
          `     Or create: New-NetFirewallRule -DisplayName "${ruleName}" -Direction Inbound -LocalPort 9222-9299 -Protocol TCP -Action Allow -RemoteAddress LocalSubnet,172.16.0.0/12`;
      }
    } else if (errMsg.includes('ENETUNREACH')) {
      console.log(`  ${C.red}✗${C.reset} Network unreachable`);
      issues.push({
        level: 'error',
        message: 'Network unreachable - Windows host IP may be wrong',
        fix: `Check Windows IP. Current: ${windowsHostIP}`
      });
    } else if (errMsg === 'fetch failed' || errMsg.includes('fetch failed')) {
      console.log(`  ${C.red}✗${C.reset} Connection failed (Chrome bound to localhost only)`);
      issues.push({
        level: 'error',
        message: 'WSL cannot reach Chrome - bound to 127.0.0.1 (expected since Chrome M113)',
        fix: 'Port proxy is required for WSL access:\n' +
             `     netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1\n` +
             '     (Chrome M113+ ignores --remote-debugging-address=0.0.0.0 for security)'
      });
    } else {
      console.log(`  ${C.red}✗${C.reset} ${errMsg.substring(0, 60)}`);
      issues.push({
        level: 'error',
        message: `Connection failed: ${errMsg.substring(0, 60)}`
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${C.bold}${C.cyan}─────────────────────────────────────────────────────────────────────────────${C.reset}`);

  if (canConnect) {
    console.log(`${C.bold}${C.green}✓ All checks passed - connection should work${C.reset}`);
  } else if (issues.length === 0) {
    console.log(`${C.bold}${C.yellow}? Diagnostics complete but connection failed - unknown issue${C.reset}`);
  } else {
    const errors = issues.filter(i => i.level === 'error');
    const warnings = issues.filter(i => i.level === 'warn');

    console.log(`${C.bold}${C.red}✗ Found ${errors.length} error(s) and ${warnings.length} warning(s)${C.reset}`);
    console.log('');

    for (const issue of errors) {
      console.log(`${C.red}ERROR:${C.reset} ${issue.message}`);
      if (issue.fix) {
        console.log(`${C.green}FIX:${C.reset}`);
        console.log(`     ${issue.fix.split('\n').join('\n     ')}`);
      }
      console.log('');
    }

    for (const issue of warnings) {
      console.log(`${C.yellow}WARNING:${C.reset} ${issue.message}`);
      if (issue.fix) {
        console.log(`${C.dim}Suggestion:${C.reset}`);
        console.log(`     ${issue.fix.split('\n').join('\n     ')}`);
      }
      console.log('');
    }

    // Quick fix summary
    if (errors.length > 0) {
      const hasConflict = issues.some(i => i.message.includes('Port proxy conflict'));

      if (hasConflict) {
        console.log(`${C.bold}${C.yellow}═══════════════════════════════════════════════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.yellow}  AUTO-FIX AVAILABLE: Port Proxy Conflict${C.reset}`);
        console.log(`${C.bold}${C.yellow}═══════════════════════════════════════════════════════════════════════════════${C.reset}`);
        console.log('');
        console.log(`  The port proxy grabbed port ${actualPort} before Chrome could bind to it.`);
        console.log(`  Chrome fell back to IPv6 localhost [::1], but port proxy expects IPv4.`);
        console.log('');
        console.log(`  ${C.bold}Solution:${C.reset} Remove port proxy, restart Chrome, then re-add port proxy.`);
        console.log(`  ${C.dim}(Port proxy must be added AFTER Chrome starts)${C.reset}`);
        console.log('');
      }

      console.log(`${C.bold}Quick Fix Commands (run in PowerShell as Admin):${C.reset}`);
      console.log('');

      const needsFirewall = issues.some(i =>
        i.message.toLowerCase().includes('firewall') ||
        i.message.toLowerCase().includes('timeout')
      );
      const needsPortProxy = issues.some(i =>
        i.message.toLowerCase().includes('port proxy needed') ||
        i.message.toLowerCase().includes('connection refused') ||
        i.message.toLowerCase().includes('bound to 127.0.0.1') ||
        i.message.toLowerCase().includes('wsl cannot reach')
      );
      const needsChromeRestart = issues.some(i =>
        i.message.toLowerCase().includes('restart chrome') ||
        i.message.toLowerCase().includes('without remote debugging') ||
        i.message.toLowerCase().includes('no chrome') ||
        i.message.toLowerCase().includes('singleton')
      );

      let anyCommandPrinted = false;

      if (hasConflict) {
        console.log(`  ${C.cyan}# Step 1: Remove conflicting port proxy:${C.reset}`);
        console.log(`  netsh interface portproxy delete v4tov4 listenport=${actualPort} listenaddress=0.0.0.0`);
        console.log('');
        console.log(`  ${C.cyan}# Step 2: Kill browsermonitor Chrome only (not your browser!):${C.reset}`);
        console.log(`  Get-WmiObject Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match 'browsermonitor' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
        console.log('');
        console.log(`  ${C.cyan}# Step 3: Run browsermonitor again${C.reset}`);
        console.log(`  ${C.dim}(Port proxy will be set up automatically after Chrome starts)${C.reset}`);
        console.log('');
        anyCommandPrinted = true;
      } else {
        if (needsFirewall) {
          const ourRuleName = 'Chrome Debug (browsermonitor)';
          const ourRuleExists = runPowerShell(`Get-NetFirewallRule -DisplayName '${ourRuleName}' -ErrorAction SilentlyContinue | ConvertTo-Json`);
          const hasOurRule = ourRuleExists && ourRuleExists !== 'null' && ourRuleExists !== '';

          if (hasOurRule) {
            console.log(`  ${C.cyan}# Update existing rule to include WSL subnet:${C.reset}`);
            console.log(`  Set-NetFirewallRule -DisplayName "${ourRuleName}" -RemoteAddress LocalSubnet,172.16.0.0/12`);
          } else if (existingRuleName) {
            console.log(`  ${C.cyan}# Found existing rule "${existingRuleName}" - update it:${C.reset}`);
            console.log(`  Set-NetFirewallRule -DisplayName "${existingRuleName}" -RemoteAddress LocalSubnet,172.16.0.0/12`);
            console.log('');
            console.log(`  ${C.cyan}# Or create a dedicated rule for browsermonitor:${C.reset}`);
            console.log(`  New-NetFirewallRule -DisplayName "${ourRuleName}" -Direction Inbound -LocalPort 9222-9299 -Protocol TCP -Action Allow -RemoteAddress LocalSubnet,172.16.0.0/12`);
          } else {
            console.log(`  ${C.cyan}# Create firewall rule (includes WSL subnet):${C.reset}`);
            console.log(`  New-NetFirewallRule -DisplayName "${ourRuleName}" -Direction Inbound -LocalPort 9222-9299 -Protocol TCP -Action Allow -RemoteAddress LocalSubnet,172.16.0.0/12`);
          }
          console.log(`  ${C.dim}# Note: 172.16.0.0/12 covers WSL2 dynamic IP range${C.reset}`);
          console.log('');
          anyCommandPrinted = true;
        }

        if (needsPortProxy && !isListeningOnAll) {
          console.log(`  ${C.cyan}# Add port proxy:${C.reset}`);
          console.log(`  netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1`);
          console.log('');
          anyCommandPrinted = true;
        }

        if (needsChromeRestart) {
          console.log(`  ${C.cyan}# Close all Chrome and restart with debug port:${C.reset}`);
          console.log(`  chrome.exe --remote-debugging-port=${actualPort}`);
          console.log(`  ${C.dim}# Then add port proxy for WSL access:${C.reset}`);
          console.log(`  netsh interface portproxy add v4tov4 listenport=${actualPort} listenaddress=0.0.0.0 connectport=${actualPort} connectaddress=127.0.0.1`);
          console.log('');
          anyCommandPrinted = true;
        }
      }

      if (!anyCommandPrinted && issues.length > 0) {
        console.log(`  ${C.yellow}No automatic fix available. Issues found:${C.reset}`);
        for (const issue of issues) {
          console.log(`  ${C.dim}• ${issue.message}${C.reset}`);
          if (issue.fix) {
            console.log(`    ${issue.fix.split('\n').join('\n    ')}`);
          }
        }
        console.log('');
      }
    }
  }

  console.log(`${C.bold}${C.cyan}─────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log('');

  const hasPortProxyConflictResult = issues.some(i => i.message.includes('Port proxy conflict'));
  return { issues, canConnect, hasPortProxyConflict: hasPortProxyConflictResult, actualPort };
}
