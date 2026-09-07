import { createHash } from 'node:crypto';

export function renderClassificationPrompt(template: string, categories: string[]): string {
  const matches = template.match(/{{categories}}/g) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Classification prompt must contain exactly one {{categories}} placeholder; found ${matches.length}`);
  }
  return template.replace(/{{categories}}/g, categories.map(category => `- ${category}`).join('\n'));
}

export function wrapMemoryContent(content: string): string {
  return `<memory>\n${content.replace(/<\/memory\s*>/gi, '&lt;/memory&gt;')}\n</memory>`;
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeGeneratedText(value: string): string {
  return value.replace(/\r\n/g, '\n');
}
