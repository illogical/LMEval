import { join } from 'path';
import { createPatch } from 'diff';
import { FileService } from './FileService.ts';
import { MetricsService } from './MetricsService.ts';
import type { PromptManifest, PromptVersionMeta, ToolDefinition } from '../../src/types/eval.ts';

export class PromptService {
  private static promptsDir(): string {
    return join(FileService.evalsDir(), 'prompts');
  }

  private static promptDir(slug: string): string {
    return join(PromptService.promptsDir(), slug);
  }

  static list(): PromptManifest[] {
    FileService.ensureDir(PromptService.promptsDir());
    const dirs = FileService.listDirs(PromptService.promptsDir());
    return dirs
      .map(d => FileService.readJson<PromptManifest>(join(d, 'manifest.json')))
      .filter((m): m is PromptManifest => m !== null);
  }

  static get(id: string): PromptManifest | null {
    const dirs = FileService.listDirs(PromptService.promptsDir());
    for (const d of dirs) {
      const manifest = FileService.readJson<PromptManifest>(join(d, 'manifest.json'));
      if (manifest && (manifest.id === id || manifest.slug === id)) {
        return manifest;
      }
    }
    return null;
  }

  static getVersionContent(id: string, version: number): string | null {
    const manifest = PromptService.get(id);
    if (!manifest) return null;
    const promptDir = PromptService.promptDir(manifest.slug);
    return FileService.readMarkdown(join(promptDir, `v${version}.md`));
  }

  static create(data: { name: string; content: string; description?: string; notes?: string }): PromptManifest {
    FileService.ensureDir(PromptService.promptsDir());
    const slug = FileService.generateSlug(data.name);
    const id = FileService.generateId();
    const now = new Date().toISOString();
    const promptDir = PromptService.promptDir(slug);
    FileService.ensureDir(promptDir);

    const tokens = PromptService.estimateTokens(data.content);
    const versionMeta: PromptVersionMeta = {
      version: 1,
      notes: data.notes,
      filePath: `v1.md`,
      createdAt: now,
      tokenEstimate: tokens
    };

    const manifest: PromptManifest = {
      id,
      slug,
      name: data.name,
      description: data.description,
      currentVersion: 1,
      versions: [versionMeta],
      createdAt: now,
      updatedAt: now
    };

    FileService.writeMarkdown(join(promptDir, 'v1.md'), data.content);
    FileService.writeJson(join(promptDir, 'manifest.json'), manifest);
    return manifest;
  }

  static addVersion(id: string, data: { content: string; notes?: string }): PromptManifest {
    const manifest = PromptService.get(id);
    if (!manifest) throw new Error(`Prompt not found: ${id}`);

    const promptDir = PromptService.promptDir(manifest.slug);
    const newVersion = manifest.currentVersion + 1;
    const now = new Date().toISOString();
    const tokens = PromptService.estimateTokens(data.content);

    const versionMeta: PromptVersionMeta = {
      version: newVersion,
      notes: data.notes,
      filePath: `v${newVersion}.md`,
      createdAt: now,
      tokenEstimate: tokens
    };

    const updated: PromptManifest = {
      ...manifest,
      currentVersion: newVersion,
      versions: [...manifest.versions, versionMeta],
      updatedAt: now
    };

    FileService.writeMarkdown(join(promptDir, `v${newVersion}.md`), data.content);
    FileService.writeJson(join(promptDir, 'manifest.json'), updated);
    return updated;
  }

  static diff(id: string, v1: number, v2: number): string {
    const content1 = PromptService.getVersionContent(id, v1) ?? '';
    const content2 = PromptService.getVersionContent(id, v2) ?? '';
    return createPatch(`v${v1} → v${v2}`, content1, content2, `v${v1}`, `v${v2}`);
  }

  static updateTools(id: string, toolDefinitions: ToolDefinition[]): PromptManifest {
    const manifest = PromptService.get(id);
    if (!manifest) throw new Error(`Prompt not found: ${id}`);

    const promptDir = PromptService.promptDir(manifest.slug);
    const updated: PromptManifest = {
      ...manifest,
      toolDefinitions,
      updatedAt: new Date().toISOString()
    };

    FileService.writeJson(join(promptDir, 'tools.json'), toolDefinitions);
    FileService.writeJson(join(promptDir, 'manifest.json'), updated);
    return updated;
  }

  static estimateTokens(content: string): number {
    // Approximates GPT-style tokenizers: ~4 chars per token (±25% variance for typical text)
    return MetricsService.estimateTokenCount(content);
  }

  static delete(id: string): void {
    const manifest = PromptService.get(id);
    if (!manifest) throw new Error(`Prompt not found: ${id}`);
    FileService.deleteDir(PromptService.promptDir(manifest.slug));
  }
}
