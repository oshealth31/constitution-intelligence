import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Walks up from `startDir` until it finds the monorepo root
 * (the folder containing pnpm-workspace.yaml). Returns undefined if none is found.
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string | undefined {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, WORKSPACE_MARKER))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export interface LoadLocalEnvOptions {
  /** Folder to start searching from. Defaults to the current working directory. */
  startDir?: string;
  /** Environment object to populate. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** File name to load from the workspace root. Defaults to ".env". */
  fileName?: string;
}

export interface LoadLocalEnvResult {
  loaded: boolean;
  reason: 'loaded' | 'production' | 'no-workspace' | 'no-file';
  /** Names (never values) of the variables that were set from the file. */
  keys: string[];
}

/**
 * Loads the root ".env" file for LOCAL development only.
 *
 * Rules:
 * - Never runs when NODE_ENV is "production": deployed environments get their
 *   settings from the hosting provider's secret manager, not from files.
 * - Never overrides a variable that is already set in the real environment.
 */
export function loadLocalEnv(options: LoadLocalEnvOptions = {}): LoadLocalEnvResult {
  const env = options.env ?? process.env;

  if (env.NODE_ENV === 'production') {
    return { loaded: false, reason: 'production', keys: [] };
  }

  const root = findWorkspaceRoot(options.startDir);
  if (!root) {
    return { loaded: false, reason: 'no-workspace', keys: [] };
  }

  const file = path.join(root, options.fileName ?? '.env');
  if (!fs.existsSync(file)) {
    return { loaded: false, reason: 'no-file', keys: [] };
  }

  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  const keys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined && value !== undefined) {
      env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, reason: 'loaded', keys };
}
