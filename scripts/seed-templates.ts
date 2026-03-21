import { join } from 'path';
import { readJson, writeJson, ensureDir, TEMPLATES_DIR, CUSTOM_TEMPLATES_DIR } from '../server/services/FileService';
import type { EvalTemplate } from '../src/types/eval';

const BUILT_IN_TEMPLATE_IDS = [
  'general-quality',
  'tool-calling',
  'code-generation',
  'instruction-following',
];

async function seedTemplates(): Promise<void> {
  ensureDir(TEMPLATES_DIR);
  ensureDir(CUSTOM_TEMPLATES_DIR);

  let seeded = 0;
  let skipped = 0;

  for (const id of BUILT_IN_TEMPLATE_IDS) {
    const destPath = join(TEMPLATES_DIR, `${id}.json`);
    const srcPath = join(process.cwd(), 'data', 'evals', 'templates', `${id}.json`);

    const existing = readJson<EvalTemplate>(destPath);
    if (existing?.builtIn) {
      console.log(`  skip: ${id} (already seeded)`);
      skipped++;
      continue;
    }

    const template = readJson<EvalTemplate>(srcPath);
    if (!template) {
      console.warn(`  warn: source not found for ${id}`);
      continue;
    }

    writeJson(destPath, template);
    console.log(`  seed: ${id}`);
    seeded++;
  }

  console.log(`\nSeeding complete: ${seeded} seeded, ${skipped} skipped`);
}

seedTemplates().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
