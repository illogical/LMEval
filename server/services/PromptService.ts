import { join } from 'path';
import { createTwoFilesPatch } from 'diff';
import {
  readJson,
  writeJson,
  readText,
  writeText,
  listDir,
  generateId,
  slugify,
  ensureDir,
  PROMPTS_DIR,
} from './FileService';
import type { PromptManifest, ToolDefinition } from '../../src/types/eval';

export const PromptService = {
  list(): PromptManifest[] {
    ensureDir(PROMPTS_DIR);
    const manifests: PromptManifest[] = [];
    for (const slug of listDir(PROMPTS_DIR)) {
      const m = readJson<PromptManifest>(join(PROMPTS_DIR, slug, 'manifest.json'));
      if (m) manifests.push(m);
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string): PromptManifest | null {
    for (const slug of listDir(PROMPTS_DIR)) {
      const m = readJson<PromptManifest>(join(PROMPTS_DIR, slug, 'manifest.json'));
      if (m?.id === id) return m;
    }
    return null;
  },

  getVersionContent(id: string, version: number): string | null {
    const manifest = this.get(id);
    if (!manifest) return null;
    return readText(join(PROMPTS_DIR, manifest.slug, `v${version}.md`));
  },

  create(data: { name: string; content: string; description?: string }): PromptManifest {
    ensureDir(PROMPTS_DIR);
    const now = new Date().toISOString();
    const slug = slugify(data.name);
    const promptDir = join(PROMPTS_DIR, slug);
    ensureDir(promptDir);

    const manifest: PromptManifest = {
      id: generateId('prm'),
      slug,
      name: data.name,
      description: data.description,
      versions: [{ version: 1, createdAt: now, tokensEstimate: this.estimateTokens(data.content) }],
      createdAt: now,
      updatedAt: now,
    };

    writeJson(join(promptDir, 'manifest.json'), manifest);
    writeText(join(promptDir, 'v1.md'), data.content);
    return manifest;
  },

  addVersion(id: string, content: string, description?: string): PromptManifest | null {
    const manifest = this.get(id);
    if (!manifest) return null;

    const now = new Date().toISOString();
    const nextVersion = (manifest.versions.at(-1)?.version ?? 0) + 1;
    const meta = {
      version: nextVersion,
      createdAt: now,
      description,
      tokensEstimate: this.estimateTokens(content),
    };

    manifest.versions.push(meta);
    manifest.updatedAt = now;

    const promptDir = join(PROMPTS_DIR, manifest.slug);
    writeJson(join(promptDir, 'manifest.json'), manifest);
    writeText(join(promptDir, `v${nextVersion}.md`), content);
    return manifest;
  },

  diff(id: string, versionA: number, versionB: number): string | null {
    const contentA = this.getVersionContent(id, versionA);
    const contentB = this.getVersionContent(id, versionB);
    if (contentA === null || contentB === null) return null;
    return createTwoFilesPatch(`v${versionA}.md`, `v${versionB}.md`, contentA, contentB);
  },

  updateTools(id: string, tools: ToolDefinition[]): PromptManifest | null {
    const manifest = this.get(id);
    if (!manifest) return null;

    manifest.tools = tools;
    manifest.updatedAt = new Date().toISOString();
    writeJson(join(PROMPTS_DIR, manifest.slug, 'manifest.json'), manifest);
    writeJson(join(PROMPTS_DIR, manifest.slug, 'tools.json'), tools);
    return manifest;
  },

  estimateTokens(content: string): number {
    // Rough approximation: average English word encodes to ~1.33 tokens
    const TOKENS_PER_WORD = 1.33;
    return Math.ceil(content.split(/\s+/).length * TOKENS_PER_WORD);
  },
};
