import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWorkspaceRoot, loadLocalEnv } from '../src/env';

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-env-'));
  fs.writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), 'packages: []\n');
  fs.mkdirSync(path.join(tempRoot, 'apps', 'api'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('findWorkspaceRoot', () => {
  it('finds the folder containing pnpm-workspace.yaml from a nested folder', () => {
    expect(findWorkspaceRoot(path.join(tempRoot, 'apps', 'api'))).toBe(tempRoot);
  });
});

describe('loadLocalEnv', () => {
  it('loads values from the root .env file without overriding existing ones', () => {
    fs.writeFileSync(path.join(tempRoot, '.env'), 'FROM_FILE=file-value\nALREADY_SET=file-value\n');
    const env: NodeJS.ProcessEnv = { ALREADY_SET: 'real-value' };

    const result = loadLocalEnv({ startDir: path.join(tempRoot, 'apps', 'api'), env });

    expect(result.loaded).toBe(true);
    expect(result.keys).toEqual(['FROM_FILE']);
    expect(env.FROM_FILE).toBe('file-value');
    expect(env.ALREADY_SET).toBe('real-value');
  });

  it('never reads a .env file in production', () => {
    fs.writeFileSync(path.join(tempRoot, '.env'), 'FROM_FILE=file-value\n');
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };

    const result = loadLocalEnv({ startDir: tempRoot, env });

    expect(result).toEqual({ loaded: false, reason: 'production', keys: [] });
    expect(env.FROM_FILE).toBeUndefined();
  });

  it('reports a missing .env file without failing', () => {
    const result = loadLocalEnv({ startDir: tempRoot, env: {} });
    expect(result.reason).toBe('no-file');
  });
});
