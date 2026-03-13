import { join } from 'path';
import {
  readJson,
  writeJson,
  deleteFile,
  listDir,
  generateId,
  TEMPLATES_DIR,
  CUSTOM_TEMPLATES_DIR,
  ensureDir,
} from './FileService';
import type { EvalTemplate } from '../../src/types/eval';

const BUILT_IN_IDS = new Set([
  'general-quality',
  'tool-calling',
  'code-generation',
  'instruction-following',
]);

export const TemplateService = {
  list(): EvalTemplate[] {
    ensureDir(TEMPLATES_DIR);
    ensureDir(CUSTOM_TEMPLATES_DIR);

    const builtIn: EvalTemplate[] = [];
    const custom: EvalTemplate[] = [];

    for (const file of listDir(TEMPLATES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const t = readJson<EvalTemplate>(join(TEMPLATES_DIR, file));
      if (t) builtIn.push(t);
    }

    for (const file of listDir(CUSTOM_TEMPLATES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const t = readJson<EvalTemplate>(join(CUSTOM_TEMPLATES_DIR, file));
      if (t) custom.push(t);
    }

    return [...builtIn, ...custom];
  },

  get(id: string): EvalTemplate | null {
    const path = BUILT_IN_IDS.has(id)
      ? join(TEMPLATES_DIR, `${id}.json`)
      : join(CUSTOM_TEMPLATES_DIR, `${id}.json`);
    return readJson<EvalTemplate>(path);
  },

  create(data: Omit<EvalTemplate, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>): EvalTemplate {
    ensureDir(CUSTOM_TEMPLATES_DIR);
    const now = new Date().toISOString();
    const template: EvalTemplate = {
      ...data,
      id: generateId('tpl'),
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    writeJson(join(CUSTOM_TEMPLATES_DIR, `${template.id}.json`), template);
    return template;
  },

  update(id: string, data: Partial<Omit<EvalTemplate, 'id' | 'builtIn' | 'createdAt'>>): EvalTemplate | null {
    if (BUILT_IN_IDS.has(id)) throw new Error(`Cannot update built-in template: ${id}`);
    const existing = this.get(id);
    if (!existing) return null;
    const updated: EvalTemplate = {
      ...existing,
      ...data,
      id,
      builtIn: false,
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(CUSTOM_TEMPLATES_DIR, `${id}.json`), updated);
    return updated;
  },

  delete(id: string): boolean {
    if (BUILT_IN_IDS.has(id)) throw new Error(`Cannot delete built-in template: ${id}`);
    return deleteFile(join(CUSTOM_TEMPLATES_DIR, `${id}.json`));
  },

  isBuiltIn(id: string): boolean {
    return BUILT_IN_IDS.has(id);
  },

  seedBuiltIns(): void {
    ensureDir(TEMPLATES_DIR);
    for (const id of BUILT_IN_IDS) {
      const path = join(TEMPLATES_DIR, `${id}.json`);
      if (!readJson(path)) {
        console.warn(`Built-in template not found at ${path} — run scripts/seed-templates.ts`);
      }
    }
  },
};
