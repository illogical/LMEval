import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

export class FileService {
  static evalsDir(): string {
    return join(PROJECT_ROOT, 'data', 'evals');
  }

  static readJson<T>(filePath: string): T | null {
    try {
      if (!existsSync(filePath)) return null;
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  static writeJson(filePath: string, data: unknown): void {
    FileService.ensureDir(dirname(filePath));
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  static readMarkdown(filePath: string): string | null {
    try {
      if (!existsSync(filePath)) return null;
      return readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  static writeMarkdown(filePath: string, content: string): void {
    FileService.ensureDir(dirname(filePath));
    writeFileSync(filePath, content, 'utf-8');
  }

  static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 64);
  }

  static generateId(): string {
    return randomUUID();
  }

  static listJsonFiles(dir: string): string[] {
    try {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => join(dir, f));
    } catch {
      return [];
    }
  }

  static listDirs(dir: string): string[] {
    try {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter(f => {
        try {
          return statSync(join(dir, f)).isDirectory();
        } catch {
          return false;
        }
      }).map(f => join(dir, f));
    } catch {
      return [];
    }
  }

  static ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  static fileExists(filePath: string): boolean {
    return existsSync(filePath);
  }

  static deleteFile(filePath: string): void {
    try {
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
    } catch (e) {
      throw new Error(`Failed to delete file ${filePath}: ${e}`);
    }
  }

  static deleteDir(dirPath: string): void {
    try {
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true });
      }
    } catch (e) {
      throw new Error(`Failed to delete directory ${dirPath}: ${e}`);
    }
  }
}
