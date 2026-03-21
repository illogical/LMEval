import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, writeFileSync } from 'fs';

const execFileAsync = promisify(execFile);
const DATA_ROOT = join(process.cwd(), 'data');

function gitExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', DATA_ROOT, ...args]);
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  date: string;
  author: string;
}

export interface GitStatus {
  initialized: boolean;
  clean: boolean;
  files: string[];
  log: GitLogEntry[];
}

export const GitService = {
  async isInitialized(): Promise<boolean> {
    try {
      await gitExec(['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  },

  async init(): Promise<void> {
    const initialized = await this.isInitialized();
    if (!initialized) {
      await gitExec(['init']);
      await gitExec(['config', 'user.email', 'lmeval@local']);
      await gitExec(['config', 'user.name', 'LMEval']);
    }
    const gitignorePath = join(DATA_ROOT, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '*.tmp\n', 'utf-8');
    }
  },

  async status(): Promise<GitStatus> {
    const initialized = await this.isInitialized();
    if (!initialized) {
      return { initialized: false, clean: true, files: [], log: [] };
    }

    let files: string[] = [];
    try {
      const { stdout } = await gitExec(['status', '--porcelain']);
      files = stdout.trim().split('\n').filter(Boolean).map(l => l.trim());
    } catch {
      // ignore
    }

    const log = await this.log(10);
    return { initialized, clean: files.length === 0, files, log };
  },

  async commit(message: string): Promise<string> {
    if (!/^(feat|fix|chore)\(prompt\):/.test(message)) {
      throw new Error('Commit message must start with feat(prompt):, fix(prompt):, or chore(prompt):');
    }

    await gitExec(['add', '-A']);
    const { stdout } = await gitExec(['commit', '-m', message]);
    const match = stdout.match(/\[[\w/]+\s+([0-9a-f]+)\]/);
    return match?.[1] ?? '';
  },

  async log(limit = 10): Promise<GitLogEntry[]> {
    try {
      const { stdout } = await gitExec([
        'log',
        `--max-count=${limit}`,
        '--pretty=format:%H|%s|%ci|%an',
      ]);
      if (!stdout.trim()) return [];
      return stdout
        .trim()
        .split('\n')
        .map(line => {
          const [hash, subject, date, author] = line.split('|');
          return { hash: hash ?? '', subject: subject ?? '', date: date ?? '', author: author ?? '' };
        });
    } catch {
      return [];
    }
  },

  async revert(hash: string): Promise<void> {
    if (!/^[0-9a-f]{4,64}$/.test(hash)) {
      throw new Error('Invalid commit hash');
    }
    await gitExec(['revert', '--no-edit', hash]);
  },
};
