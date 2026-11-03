import { isIsoDate, toIsoDate } from './dates.js';
import type { AiCitationInput } from './types.js';
import { normalizePage } from './url.js';

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function toDate(value: string): string | null {
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : toIsoDate(d);
}

export interface CitationImportResult {
  rows: AiCitationInput[];
  skipped: number;
  columns: { page: string; citations: string; date: string | null };
}

/**
 * Parses an AI citation export (e.g. Bing Webmaster Tools → AI Performance →
 * Export). Columns are detected by name: a URL/page column, a citations column
 * and an optional date column. Without a date column, `defaultDate` is used.
 */
export function parseAiCitationsCsv(text: string, opts: { domain: string; defaultDate: string; surface?: string }): CitationImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const pageIdx = find(/url|page/);
  const citeIdx = find(/citation|cited|mention/);
  const dateIdx = find(/^date$|^day$|week|date/);
  if (pageIdx === -1 || citeIdx === -1) {
    throw new Error(`Could not find URL and citation columns in: ${rows[0]!.join(', ')}`);
  }
  const out: AiCitationInput[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const url = (r[pageIdx] ?? '').trim();
    const n = Number((r[citeIdx] ?? '').replace(/[,\s]/g, ''));
    const date = dateIdx >= 0 ? toDate(r[dateIdx] ?? '') : opts.defaultDate;
    if (!url || !Number.isFinite(n) || !date) {
      skipped++;
      continue;
    }
    out.push({ date, page: normalizePage(url, opts.domain), surface: opts.surface ?? 'bing_copilot', citations: Math.round(n) });
  }
  return { rows: out, skipped, columns: { page: rows[0]![pageIdx]!, citations: rows[0]![citeIdx]!, date: dateIdx >= 0 ? rows[0]![dateIdx]! : null } };
}
