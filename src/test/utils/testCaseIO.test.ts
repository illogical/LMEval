import { describe, expect, it } from 'vitest';
import { parseCSV, parseJSON, serializeCSV, serializeJSON } from '../../utils/testCaseIO';
import type { TestCase } from '../../types/eval';

const grounded: TestCase = {
  id: 'case-1',
  description: 'Grounded case',
  userMessage: '<memory>\nRemember API-42\n</memory>',
  expectedOutput: 'Note',
  expectedLabels: ['Programming', 'Reference'],
  caseTags: ['split:calibration', 'risk:technical'],
  requiredFacts: ['API-42'],
  forbiddenClaims: ['API-43'],
  protectedTokens: ['API-42'],
};

describe('test-case import and export', () => {
  it('round-trips every grounding field through JSON without exporting ids or legacy tags', () => {
    const parsed = parseJSON(serializeJSON([{ ...grounded, tags: ['legacy'] }]));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...withoutId } = grounded;
    expect(parsed.errors).toEqual([]);
    expect(parsed.cases).toEqual([withoutId]);
    expect(serializeJSON([{ ...grounded, tags: ['legacy'] }])).not.toContain('"tags"');
  });

  it('round-trips semicolon-delimited array fields through CSV', () => {
    const parsed = parseCSV(serializeCSV([grounded]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.cases[0]).toMatchObject({
      expectedLabels: grounded.expectedLabels,
      caseTags: grounded.caseTags,
      requiredFacts: grounded.requiredFacts,
      forbiddenClaims: grounded.forbiddenClaims,
      protectedTokens: grounded.protectedTokens,
    });
  });

  it('uses expectedLabels over conflicting legacy tags and preserves unrelated JSON fields', () => {
    const parsed = parseJSON(JSON.stringify([{
      userMessage: 'x', expectedLabels: ['A', 'B'], tags: ['B', 'C'], customEvidence: { source: 'review' },
    }]));
    expect(parsed.cases[0]).toMatchObject({
      expectedLabels: ['A', 'B'],
      customEvidence: { source: 'review' },
    });
    expect(parsed.cases[0]).not.toHaveProperty('tags');
    expect(parsed.warnings).toEqual(['Item 1: expectedLabels and legacy tags differ; expectedLabels was used.']);
  });

  it('accepts order-insensitive equivalent aliases without warning', () => {
    const parsed = parseJSON(JSON.stringify([{ userMessage: 'x', expectedLabels: ['A', 'B'], tags: ['B', 'A'] }]));
    expect(parsed.warnings).toEqual([]);
  });

  it('maps legacy CSV tags into expectedLabels', () => {
    const parsed = parseCSV('userMessage,tags\r\nx,A;B');
    expect(parsed.cases[0].expectedLabels).toEqual(['A', 'B']);
  });
});
