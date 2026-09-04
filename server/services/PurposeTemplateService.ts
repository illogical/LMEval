import { join } from 'path';
import {
  readJson,
  writeJson,
  deleteFile,
  listDir,
  generateId,
  BUILT_IN_PURPOSE_TEMPLATES_DIR,
  CUSTOM_PURPOSE_TEMPLATES_DIR,
  ensureDir,
} from './FileService';
import type { EvalPurposeTemplate } from '../../src/types/eval';

const BUILT_IN_IDS = new Set(['classification', 'tagging', 'summarization']);

export const PurposeTemplateService = {
  list(): EvalPurposeTemplate[] {
    ensureDir(BUILT_IN_PURPOSE_TEMPLATES_DIR);
    ensureDir(CUSTOM_PURPOSE_TEMPLATES_DIR);

    const builtIn: EvalPurposeTemplate[] = [];
    const custom: EvalPurposeTemplate[] = [];

    for (const file of listDir(BUILT_IN_PURPOSE_TEMPLATES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const t = readJson<EvalPurposeTemplate>(join(BUILT_IN_PURPOSE_TEMPLATES_DIR, file));
      if (t) builtIn.push(t);
    }

    for (const file of listDir(CUSTOM_PURPOSE_TEMPLATES_DIR)) {
      if (!file.endsWith('.json')) continue;
      const t = readJson<EvalPurposeTemplate>(join(CUSTOM_PURPOSE_TEMPLATES_DIR, file));
      if (t) custom.push(t);
    }

    return [...builtIn, ...custom];
  },

  get(id: string): EvalPurposeTemplate | null {
    const path = BUILT_IN_IDS.has(id)
      ? join(BUILT_IN_PURPOSE_TEMPLATES_DIR, `${id}.json`)
      : join(CUSTOM_PURPOSE_TEMPLATES_DIR, `${id}.json`);
    return readJson<EvalPurposeTemplate>(path);
  },

  create(data: Omit<EvalPurposeTemplate, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>): EvalPurposeTemplate {
    ensureDir(CUSTOM_PURPOSE_TEMPLATES_DIR);
    const now = new Date().toISOString();
    const template: EvalPurposeTemplate = {
      ...data,
      id: generateId('purp'),
      purposeCategory: 'custom',
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    writeJson(join(CUSTOM_PURPOSE_TEMPLATES_DIR, `${template.id}.json`), template);
    return template;
  },

  update(id: string, data: Partial<Omit<EvalPurposeTemplate, 'id' | 'builtIn' | 'createdAt'>>): EvalPurposeTemplate | null {
    if (BUILT_IN_IDS.has(id)) throw new Error(`Cannot update built-in purpose template: ${id}`);
    const existing = this.get(id);
    if (!existing) return null;
    const updated: EvalPurposeTemplate = {
      ...existing,
      ...data,
      id,
      builtIn: false,
      updatedAt: new Date().toISOString(),
    };
    writeJson(join(CUSTOM_PURPOSE_TEMPLATES_DIR, `${id}.json`), updated);
    return updated;
  },

  delete(id: string): boolean {
    if (BUILT_IN_IDS.has(id)) throw new Error(`Cannot delete built-in purpose template: ${id}`);
    return deleteFile(join(CUSTOM_PURPOSE_TEMPLATES_DIR, `${id}.json`));
  },

  isBuiltIn(id: string): boolean {
    return BUILT_IN_IDS.has(id);
  },

  seedBuiltIns(): void {
    ensureDir(BUILT_IN_PURPOSE_TEMPLATES_DIR);
    for (const id of BUILT_IN_IDS) {
      const path = join(BUILT_IN_PURPOSE_TEMPLATES_DIR, `${id}.json`);
      if (!readJson(path)) {
        console.warn(`Built-in purpose template not found at ${path} — expected data/evals/purpose-templates/${id}.json`);
      }
    }
  },
};
