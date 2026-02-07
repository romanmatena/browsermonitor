/**
 * Monitor submodule – re-exports and shared pieces.
 * Public API (runJoinMode, runOpenMode, runInteractiveMode) lives in ../monitor.mjs
 * to avoid circular deps. This index documents the monitor/ layout:
 *
 * - page-monitoring.mjs    – shared console/network listeners for a page
 * - tab-selection.mjs      – askUserToSelectPage, ensureKeypressEvents
 * - interactive-mode.mjs   – runInteractiveMode(options, deps), getChromeInstances
 */

export { setupPageMonitoring } from './page-monitoring.mjs';
export { askUserToSelectPage, ensureKeypressEvents } from './tab-selection.mjs';
export {
  runInteractiveMode,
  getChromeInstances,
  askUserToSelectChromeInstance,
} from './interactive-mode.mjs';
