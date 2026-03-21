import { join } from 'path';
import {
  readJson, writeJson, listDir, generateId, slugify,
  ensureDir, SESSIONS_DIR,
} from './FileService';
import { rmSync, existsSync } from 'fs';
import type { SessionManifest, SessionVersion, SessionVersionMeta, EvalRun, SessionSlot } from '../../src/types/session';

export const SessionService = {
  list(): SessionManifest[] {
    ensureDir(SESSIONS_DIR);
    const manifests: SessionManifest[] = [];
    for (const slug of listDir(SESSIONS_DIR)) {
      if (slug === '.gitkeep') continue;
      const m = readJson<SessionManifest>(join(SESSIONS_DIR, slug, 'manifest.json'));
      if (m) manifests.push(m);
    }
    return manifests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  get(id: string): SessionManifest | null {
    for (const slug of listDir(SESSIONS_DIR)) {
      if (slug === '.gitkeep') continue;
      const m = readJson<SessionManifest>(join(SESSIONS_DIR, slug, 'manifest.json'));
      if (m?.id === id) return m;
    }
    return null;
  },

  getBySlug(slug: string): SessionManifest | null {
    return readJson<SessionManifest>(join(SESSIONS_DIR, slug, 'manifest.json'));
  },

  getVersion(sessionId: string, version: number): SessionVersion | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;
    return readJson<SessionVersion>(join(SESSIONS_DIR, manifest.slug, `v${version}.json`));
  },

  getActiveVersion(sessionId: string): SessionVersion | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;
    return readJson<SessionVersion>(join(SESSIONS_DIR, manifest.slug, `v${manifest.latestVersion}.json`));
  },

  create(data: { name: string; description?: string; promptA: SessionSlot; promptB: SessionSlot }): SessionManifest {
    ensureDir(SESSIONS_DIR);
    const now = new Date().toISOString();
    const slug = slugify(data.name);
    const sessionDir = join(SESSIONS_DIR, slug);
    ensureDir(sessionDir);
    ensureDir(join(sessionDir, 'runs'));

    const versionMeta: SessionVersionMeta = {
      version: 1,
      createdAt: now,
      promptA: data.promptA,
      promptB: data.promptB,
    };

    const manifest: SessionManifest = {
      id: generateId('ses'),
      slug,
      name: data.name,
      description: data.description,
      latestVersion: 1,
      versions: [versionMeta],
      createdAt: now,
      updatedAt: now,
    };

    const v1: SessionVersion = {
      sessionId: manifest.id,
      version: 1,
      createdAt: now,
      promptA: data.promptA,
      promptB: data.promptB,
      evalRunIds: [],
    };

    writeJson(join(sessionDir, 'manifest.json'), manifest);
    writeJson(join(sessionDir, 'v1.json'), v1);
    return manifest;
  },

  createVersion(sessionId: string, data: { description?: string; promptA: SessionSlot; promptB: SessionSlot }): SessionVersion | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;

    const now = new Date().toISOString();
    const nextVersion = (manifest.versions.at(-1)?.version ?? 0) + 1;

    const versionMeta: SessionVersionMeta = {
      version: nextVersion,
      createdAt: now,
      description: data.description,
      promptA: data.promptA,
      promptB: data.promptB,
    };

    const sessionVersion: SessionVersion = {
      sessionId,
      version: nextVersion,
      createdAt: now,
      description: data.description,
      promptA: data.promptA,
      promptB: data.promptB,
      evalRunIds: [],
    };

    manifest.versions.push(versionMeta);
    manifest.latestVersion = nextVersion;
    manifest.updatedAt = now;

    const sessionDir = join(SESSIONS_DIR, manifest.slug);
    writeJson(join(sessionDir, 'manifest.json'), manifest);
    writeJson(join(sessionDir, `v${nextVersion}.json`), sessionVersion);
    return sessionVersion;
  },

  setLatestVersion(sessionId: string, version: number): SessionManifest | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;
    if (!manifest.versions.find(v => v.version === version)) return null;

    manifest.latestVersion = version;
    manifest.updatedAt = new Date().toISOString();
    writeJson(join(SESSIONS_DIR, manifest.slug, 'manifest.json'), manifest);
    return manifest;
  },

  addEvalRun(sessionId: string, sessionVersion: number, evalId: string): EvalRun | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;

    const now = new Date().toISOString();
    const run: EvalRun = {
      id: generateId('run'),
      sessionId,
      sessionVersion,
      evalId,
      createdAt: now,
      status: 'pending',
    };

    const sessionDir = join(SESSIONS_DIR, manifest.slug);
    const runsDir = join(sessionDir, 'runs');
    ensureDir(runsDir);
    writeJson(join(runsDir, `${run.id}.json`), run);

    // Append runId to the version's evalRunIds
    const versionFile = join(sessionDir, `v${sessionVersion}.json`);
    const version = readJson<{ evalRunIds: string[] }>(versionFile);
    if (version) {
      version.evalRunIds.push(run.id);
      writeJson(versionFile, version);
    }

    manifest.updatedAt = now;
    writeJson(join(sessionDir, 'manifest.json'), manifest);

    return run;
  },

  getEvalRun(sessionId: string, runId: string): EvalRun | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;
    return readJson<EvalRun>(join(SESSIONS_DIR, manifest.slug, 'runs', `${runId}.json`));
  },

  listEvalRuns(sessionId: string, sessionVersion?: number): EvalRun[] {
    const manifest = this.get(sessionId);
    if (!manifest) return [];
    const runsDir = join(SESSIONS_DIR, manifest.slug, 'runs');
    const runs: EvalRun[] = [];
    for (const file of listDir(runsDir)) {
      if (!file.endsWith('.json')) continue;
      const run = readJson<EvalRun>(join(runsDir, file));
      if (run && (sessionVersion == null || run.sessionVersion === sessionVersion)) {
        runs.push(run);
      }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  updateEvalRun(sessionId: string, runId: string, patch: Partial<EvalRun>): EvalRun | null {
    const manifest = this.get(sessionId);
    if (!manifest) return null;
    const runPath = join(SESSIONS_DIR, manifest.slug, 'runs', `${runId}.json`);
    const run = readJson<EvalRun>(runPath);
    if (!run) return null;
    const updated = { ...run, ...patch };
    writeJson(runPath, updated);
    return updated;
  },

  delete(sessionId: string): boolean {
    const manifest = this.get(sessionId);
    if (!manifest) return false;
    const sessionDir = join(SESSIONS_DIR, manifest.slug);
    if (!existsSync(sessionDir)) return false;
    rmSync(sessionDir, { recursive: true });
    return true;
  },
};
