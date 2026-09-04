import type { TestCase } from '../types/eval';

/** Short display name for a model id (`server::model` or `provider/model`). */
export function modelShortName(modelId: string): string {
  return modelId.split('::').pop()?.split('/').pop() ?? modelId;
}

/** Human label for a test case: its real user message when known, else a numbered fallback. */
export function testCaseLabel(testCaseId: string, testCases: TestCase[], index?: number): string {
  const tc = testCases.find(t => t.id === testCaseId);
  if (tc?.description) return tc.description;
  if (tc?.userMessage) {
    const oneLine = tc.userMessage.replace(/\s+/g, ' ').trim();
    return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
  }
  const fallbackIndex = index ?? testCases.findIndex(t => t.id === testCaseId);
  return fallbackIndex >= 0 ? `Test case #${fallbackIndex + 1}` : testCaseId;
}

/** Label for a (promptId, version) pair, resolved against a small id→name map when available. */
export function promptLabel(
  promptId: string,
  promptVersion: number,
  promptNames?: Record<string, string>
): string {
  const name = promptNames?.[promptId];
  return name ? `${name} v${promptVersion}` : `Prompt ${promptId.split('-').pop()} v${promptVersion}`;
}
