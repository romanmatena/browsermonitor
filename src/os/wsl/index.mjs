/**
 * WSL utilities for browsermonitor.
 *
 * This module provides all functionality needed for running browsermonitor
 * from WSL2 and connecting to Chrome on Windows.
 */

// Detection utilities
export {
  isWsl,
  getWslDistroName,
  getWindowsHostForWSL,
  wslToWindowsPath,
} from './detect.mjs';

// Chrome detection and launch
export {
  getLastCmdStderrAndClear,
  getWindowsLocalAppData,
  getWindowsProfilePath,
  detectWindowsChromeCanaryPath,
  detectWindowsChromePath,
  printCanaryInstallInstructions,
  scanChromeInstances,
  findProjectChrome,
  findFreeDebugPort,
  startChromeOnWindows,
  killPuppeteerMonitorChromes,
  checkChromeRunning,
  launchChromeFromWSL,
} from './chrome.mjs';

// Port proxy management
export {
  removePortProxyIfExists,
  isPortBlocked,
  setupPortProxy,
  detectChromeBindAddress,
  getPortProxyConfig,
} from './port-proxy.mjs';

// Diagnostics
export {
  runWslDiagnostics,
} from './diagnostics.mjs';
