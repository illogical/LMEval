import { join } from 'path';
import { readJson, writeJson, deleteFile, listDir, generateId, ensureDir } from './FileService';
import type { EvalPreset } from '../../src/types/eval';

const PRESETS_DIR = join(process.cwd(), 'data', 'evals', 'presets');

function presetPath(id: string) {
  return join(PRESETS_DIR, `${id}.json`);
}

export const PresetService = {
  async list(): Promise<EvalPreset[]> {
    ensureDir(PRESETS_DIR);
    const files = listDir(PRESETS_DIR).filter(f => f.endsWith('.json'));
    return files
      .map(f => readJson<EvalPreset>(join(PRESETS_DIR, f)))
      .filter((p): p is EvalPreset => p != null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async get(id: string): Promise<EvalPreset | null> {
    return readJson<EvalPreset>(presetPath(id));
  },

  async create(data: Omit<EvalPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<EvalPreset> {
    ensureDir(PRESETS_DIR);
    const now = new Date().toISOString();
    const preset: EvalPreset = {
      ...data,
      id: generateId('preset'),
      createdAt: now,
      updatedAt: now,
    };
    writeJson(presetPath(preset.id), preset);
    return preset;
  },

  async update(id: string, data: Partial<EvalPreset>): Promise<EvalPreset | null> {
    const existing = readJson<EvalPreset>(presetPath(id));
    if (!existing) return null;
    const updated: EvalPreset = { ...existing, ...data, id, updatedAt: new Date().toISOString() };
    writeJson(presetPath(id), updated);
    return updated;
  },

  async delete(id: string): Promise<boolean> {
    return deleteFile(presetPath(id));
  },
};
