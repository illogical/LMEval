import { join } from 'path';
import { FileService } from './FileService.ts';
import type { EvalTemplate } from '../../src/types/eval.ts';

const BUILT_IN_IDS = ['general-quality', 'tool-calling', 'code-generation', 'instruction-following'];

export class TemplateService {
  private static templatesDir(): string {
    return join(FileService.evalsDir(), 'templates');
  }

  private static customDir(): string {
    return join(FileService.evalsDir(), 'templates', 'custom');
  }

  static list(): EvalTemplate[] {
    const builtIns = FileService.listJsonFiles(TemplateService.templatesDir())
      .map(f => FileService.readJson<EvalTemplate>(f))
      .filter((t): t is EvalTemplate => t !== null && BUILT_IN_IDS.includes(t.id));

    FileService.ensureDir(TemplateService.customDir());
    const customs = FileService.listJsonFiles(TemplateService.customDir())
      .map(f => FileService.readJson<EvalTemplate>(f))
      .filter((t): t is EvalTemplate => t !== null);

    return [...builtIns, ...customs];
  }

  static get(id: string): EvalTemplate | null {
    // Try built-in first
    const builtInPath = join(TemplateService.templatesDir(), `${id}.json`);
    if (FileService.fileExists(builtInPath)) {
      return FileService.readJson<EvalTemplate>(builtInPath);
    }
    // Try custom
    const customPath = join(TemplateService.customDir(), `${id}.json`);
    return FileService.readJson<EvalTemplate>(customPath);
  }

  static isBuiltIn(id: string): boolean {
    return BUILT_IN_IDS.includes(id);
  }

  static create(data: Omit<EvalTemplate, 'id' | 'createdAt' | 'updatedAt'>): EvalTemplate {
    FileService.ensureDir(TemplateService.customDir());
    const now = new Date().toISOString();
    const id = FileService.generateSlug(data.name) + '-' + Date.now();
    const template: EvalTemplate = {
      ...data,
      id,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now
    };
    FileService.writeJson(join(TemplateService.customDir(), `${id}.json`), template);
    return template;
  }

  static update(id: string, data: Partial<EvalTemplate>): EvalTemplate {
    if (TemplateService.isBuiltIn(id)) {
      throw new Error(`Cannot modify built-in template: ${id}`);
    }
    const existing = TemplateService.get(id);
    if (!existing) throw new Error(`Template not found: ${id}`);
    const updated: EvalTemplate = { ...existing, ...data, id, updatedAt: new Date().toISOString() };
    FileService.writeJson(join(TemplateService.customDir(), `${id}.json`), updated);
    return updated;
  }

  static delete(id: string): void {
    if (TemplateService.isBuiltIn(id)) {
      throw new Error(`Cannot delete built-in template: ${id}`);
    }
    const path = join(TemplateService.customDir(), `${id}.json`);
    if (!FileService.fileExists(path)) throw new Error(`Template not found: ${id}`);
    FileService.deleteFile(path);
  }

  static seedBuiltIns(): void {
    // Built-ins are already on disk as JSON files, just ensure dirs exist
    FileService.ensureDir(TemplateService.templatesDir());
    FileService.ensureDir(TemplateService.customDir());
  }
}
