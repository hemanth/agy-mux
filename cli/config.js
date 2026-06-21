// agy-cloud — config manager

import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.agy-cloud');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Load config from ~/.agy-cloud/config.json
 * @returns {{ server: string, token: string } | null}
 */
export function loadConfig() {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save config to ~/.agy-cloud/config.json
 * @param {{ server: string, token: string }} config
 */
export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Check if config file exists
 * @returns {boolean}
 */
export function hasConfig() {
  return existsSync(CONFIG_FILE);
}

/**
 * Get config file path (for display)
 * @returns {string}
 */
export function configPath() {
  return CONFIG_FILE;
}
