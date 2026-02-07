/**
 * browsermonitor init – agent file updates and settings creation.
 *
 * When called from interactive mode (askForUrl: false), settings.json
 * already exists (interactive mode saved it). Only updates agent files.
 *
 * When called from `browsermonitor init` subcommand (askForUrl: true),
 * creates settings.json if missing (prompts for URL).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_SETTINGS,
  ensureDirectories,
  getPaths,
  loadSettings,
  saveSettings,
} from './settings.mjs';
import { C } from './utils/colors.mjs';
import { printBulletBox } from './templates/section-heading.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BEGIN_TAG_PREFIX = '<!-- BEGIN browser-monitor-llm-section';
const END_TAG_PREFIX = '<!-- END browser-monitor-llm-section';

const TEMPLATE_PATH = path.resolve(__dirname, 'agents.llm/browser-monitor-section.md');

/**
 * Replace existing tagged block or append template to a doc file.
 */
function replaceOrAppendSection(hostDir, docFilename, templateContent) {
  const hostPath = path.join(hostDir, docFilename);
  if (!fs.existsSync(hostPath)) return null;

  const content = fs.readFileSync(hostPath, 'utf8');
  const trimmedTemplate = templateContent.trimEnd();
  const beginIndex = content.indexOf(BEGIN_TAG_PREFIX);

  let newContent;
  let action;
  if (beginIndex === -1) {
    newContent = content.trimEnd() + '\n\n' + trimmedTemplate + '\n';
    action = 'appended';
  } else {
    const endTagStartIndex = content.indexOf(END_TAG_PREFIX, beginIndex);
    if (endTagStartIndex === -1) return null;
    const afterEndComment = content.indexOf('-->', endTagStartIndex) + 3;
    const lineEnd = content.indexOf('\n', afterEndComment);
    const endIndex = lineEnd === -1 ? content.length : lineEnd + 1;
    newContent = content.slice(0, beginIndex) + trimmedTemplate + '\n' + content.slice(endIndex);
    action = 'replaced';
  }

  try {
    fs.writeFileSync(hostPath, newContent);
    return action;
  } catch {
    return null;
  }
}

/**
 * Prompt user for default URL (single line).
 */
function askDefaultUrl(defaultValue) {
  return new Promise((resolve) => {
    process.stdout.write(`  ${C.cyan}Default URL${C.reset} [${C.dim}${defaultValue}${C.reset}]: `);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => {
      process.stdin.pause();
      const trimmed = chunk.toString().trim().split('\n')[0].trim();
      resolve(trimmed || defaultValue);
    });
  });
}

/**
 * Run browsermonitor initialization.
 */
export async function runInit(projectRoot, options = {}) {
  const { askForUrl = true, updateAgentFiles = true } = options;

  ensureDirectories(projectRoot);

  // Create settings.json if missing (only when called from `browsermonitor init` subcommand)
  const { settingsFile } = getPaths(projectRoot);
  if (!fs.existsSync(settingsFile)) {
    let defaultUrl = DEFAULT_SETTINGS.defaultUrl;
    if (askForUrl && process.stdin.isTTY) {
      defaultUrl = await askDefaultUrl(defaultUrl);
    }
    saveSettings(projectRoot, { ...DEFAULT_SETTINGS, defaultUrl });
  }

  const settings = loadSettings(projectRoot);

  // Update agent files
  const agentUpdates = [];
  if (updateAgentFiles && fs.existsSync(TEMPLATE_PATH)) {
    const templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    for (const docFile of ['CLAUDE.md', 'AGENTS.md', 'memory.md']) {
      const action = replaceOrAppendSection(projectRoot, docFile, templateContent);
      if (action) agentUpdates.push(`${action} ${C.cyan}${docFile}${C.reset}`);
    }
  }

  // Gitignore check
  let gitignoreHint = null;
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.browsermonitor')) {
      gitignoreHint = `${C.yellow}Tip:${C.reset} add ${C.cyan}.browsermonitor/${C.reset} to .gitignore`;
    }
  }

  // Display results
  const lines = [
    `${C.cyan}Project:${C.reset} ${projectRoot}`,
    `${C.green}Created${C.reset} .browsermonitor/ → ${C.cyan}${settings.defaultUrl}${C.reset}`,
  ];
  if (agentUpdates.length > 0) {
    lines.push(`${C.green}Agent docs:${C.reset} ${agentUpdates.join(', ')}`);
  }
  if (gitignoreHint) lines.push(gitignoreHint);

  console.log('');
  printBulletBox(lines);
  console.log('');
}
