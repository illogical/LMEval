import type { TestCase } from '../types/eval';

export interface ParseResult {
  cases: Omit<TestCase, 'id'>[];
  warnings: string[];
  errors: string[];
}

const ARRAY_FIELDS = ['expectedLabels', 'caseTags', 'requiredFacts', 'forbiddenClaims', 'protectedTokens'] as const;

function splitList(value: unknown, separator: RegExp = /[;,]/): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (typeof value === 'string' && value.trim()) return value.split(separator).map(v => v.trim()).filter(Boolean);
  return undefined;
}

function sameSet(a: string[], b: string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// ─── RFC 4180 CSV parser ───────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      // Quoted field
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++; // closing quote
            break;
          }
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      // Unquoted field
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
  return fields;
}

/** Split CSV text into rows, respecting quoted newlines */
function splitCSVRows(text: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (current.length > 0) rows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

export function parseCSV(text: string): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const cases: Omit<TestCase, 'id'>[] = [];

  const rows = splitCSVRows(text.trim());
  if (rows.length === 0) {
    errors.push('File is empty.');
    return { cases, warnings, errors };
  }

  const headers = parseCSVLine(rows[0]).map(h => h.trim().toLowerCase());
  const colOf = (name: string) => headers.indexOf(name.toLowerCase());

  const userMessageCol = colOf('userMessage');
  if (userMessageCol === -1) {
    errors.push("Missing required column 'userMessage'.");
    return { cases, warnings, errors };
  }

  const descriptionCol = colOf('description');
  const expectedOutputCol = colOf('expectedOutput');
  const tagsCol = colOf('tags');
  const arrayCols = Object.fromEntries(ARRAY_FIELDS.map(field => [field, colOf(field)])) as Record<typeof ARRAY_FIELDS[number], number>;

  for (let r = 1; r < rows.length; r++) {
    const fields = parseCSVLine(rows[r]);
    const userMessage = fields[userMessageCol]?.trim() ?? '';
    if (!userMessage) {
      warnings.push(`Row ${r + 1}: missing userMessage — skipped.`);
      continue;
    }
    const tc: Omit<TestCase, 'id'> = { userMessage };
    if (descriptionCol !== -1 && fields[descriptionCol]?.trim()) {
      tc.description = fields[descriptionCol].trim();
    }
    if (expectedOutputCol !== -1 && fields[expectedOutputCol]?.trim()) {
      tc.expectedOutput = fields[expectedOutputCol].trim();
    }
    for (const field of ARRAY_FIELDS) {
      const col = arrayCols[field];
      if (col !== -1) tc[field] = splitList(fields[col], /;/);
    }
    const legacyTags = tagsCol !== -1 ? splitList(fields[tagsCol], /;/) : undefined;
    if (!tc.expectedLabels && legacyTags) tc.expectedLabels = legacyTags;
    if (tc.expectedLabels && legacyTags && !sameSet(tc.expectedLabels, legacyTags)) {
      warnings.push(`Row ${r + 1}: expectedLabels and legacy tags differ; expectedLabels was used.`);
    }
    cases.push(tc);
  }

  if (cases.length === 0 && warnings.length > 0) {
    errors.push('No valid rows found.');
  }

  return { cases, warnings, errors };
}

// ─── JSON parser ──────────────────────────────────────────────────────────

export function parseJSON(text: string): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const cases: Omit<TestCase, 'id'>[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    errors.push('Invalid JSON — could not parse file.');
    return { cases, warnings, errors };
  }

  if (!Array.isArray(parsed)) {
    errors.push('JSON must be a top-level array of test case objects.');
    return { cases, warnings, errors };
  }

  for (let i = 0; i < parsed.length; i++) {
    const obj = parsed[i];
    if (typeof obj !== 'object' || obj === null) {
      warnings.push(`Item ${i + 1}: not an object — skipped.`);
      continue;
    }
    const item = obj as Record<string, unknown>;
    const userMessage = typeof item.userMessage === 'string' ? item.userMessage.trim() : '';
    if (!userMessage) {
      warnings.push(`Item ${i + 1}: missing userMessage — skipped.`);
      continue;
    }
    const tc = { ...item, userMessage } as unknown as Omit<TestCase, 'id'>;
    delete (tc as Partial<TestCase>).id;
    if (typeof item.description === 'string' && item.description.trim()) {
      tc.description = item.description.trim();
    }
    if (typeof item.expectedOutput === 'string' && item.expectedOutput.trim()) {
      tc.expectedOutput = item.expectedOutput.trim();
    }
    for (const field of ARRAY_FIELDS) tc[field] = splitList(item[field]);
    const legacyTags = splitList(item.tags);
    if (!tc.expectedLabels && legacyTags) tc.expectedLabels = legacyTags;
    if (tc.expectedLabels && legacyTags && !sameSet(tc.expectedLabels, legacyTags)) {
      warnings.push(`Item ${i + 1}: expectedLabels and legacy tags differ; expectedLabels was used.`);
    }
    delete tc.tags;
    cases.push(tc);
  }

  if (cases.length === 0 && warnings.length > 0) {
    errors.push('No valid items found.');
  }

  return { cases, warnings, errors };
}

// ─── Auto-detect ──────────────────────────────────────────────────────────

export function autoDetect(text: string, filename: string): ParseResult {
  if (filename.toLowerCase().endsWith('.csv')) return parseCSV(text);
  if (filename.toLowerCase().endsWith('.json')) return parseJSON(text);
  // Unknown extension: try JSON first, then CSV
  const jsonResult = parseJSON(text);
  if (jsonResult.errors.length === 0) return jsonResult;
  return parseCSV(text);
}

// ─── Serializers ──────────────────────────────────────────────────────────

function csvQuote(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function serializeCSV(cases: TestCase[]): string {
  const header = 'description,userMessage,expectedOutput,expectedLabels,caseTags,requiredFacts,forbiddenClaims,protectedTokens';
  const rows = cases.map(tc => {
    return [
      csvQuote(tc.description ?? ''),
      csvQuote(tc.userMessage),
      csvQuote(tc.expectedOutput ?? ''),
      ...ARRAY_FIELDS.map(field => csvQuote(tc[field]?.join(';') ?? '')),
    ].join(',');
  });
  return [header, ...rows].join('\r\n');
}

export function serializeJSON(cases: TestCase[]): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const out = cases.map(({ id, tags, ...rest }) => rest);
  return JSON.stringify(out, null, 2);
}

// ─── Download helper ──────────────────────────────────────────────────────

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export const CSV_TEMPLATE = 'description,userMessage,expectedOutput,expectedLabels,caseTags,requiredFacts,forbiddenClaims,protectedTokens\r\n';
