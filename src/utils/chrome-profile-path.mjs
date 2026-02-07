/**
 * Where the Chrome profile is stored for open mode.
 * Depends on platform: native Linux/Mac = project dir; WSL = Windows path (same drive or LOCALAPPDATA).
 */

import path from 'path';
import { isWsl } from './env.mjs';
import { getWindowsProfilePath } from '../os/wsl/chrome.mjs';

/**
 * Get Chrome profile path and a short description for the current platform.
 * @param {string} projectDir - Project root (outputDir)
 * @returns {{ path: string, where: string }}
 */
export function getChromeProfileLocation(projectDir) {
  if (!isWsl()) {
    return {
      path: path.join(projectDir, '.browsermonitor-profile'),
      where: 'Project directory',
    };
  }

  if (projectDir.startsWith('/mnt/')) {
    const winPath = projectDir
      .replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`)
      .replace(/\//g, '\\');
    return {
      path: `${winPath}\\.browsermonitor-profile`,
      where: 'Windows (same drive as project)',
    };
  }

  return {
    path: getWindowsProfilePath(projectDir),
    where: 'Windows (LOCALAPPDATA\\browsermonitor\\)',
  };
}
