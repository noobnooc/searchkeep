/**
 * Streaming reader for the report files the app stores publish: delimited text (tab or comma
 * separated, RFC 4180 quoting), optionally gzip-compressed, in UTF-8 or UTF-16 (Google Play writes
 * UTF-16). Web standard APIs only (DecompressionStream, TextDecoder).
 *
 * Rows are passed to `onRow` one at a time as `header → value` maps, so a large file never has to
 * be held in memory. Header names are lower-cased with whitespace collapsed (`Unique Counts` →
 * `unique counts`); look columns up with `column`.
 */

export type DelimitedRow = Record<string, string>;

export interface DelimitedOptions {
  /** Field separator; detected from the header line (tab, then comma, then semicolon) when omitted. */
  delimiter?: string;
}

const normalizeHeader = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

function count(text: string, ch: string): number {
  let n = 0;
  for (let i = text.indexOf(ch); i !== -1; i = text.indexOf(ch, i + 1)) n++;
  return n;
}

/** Splits one complete record (which may span lines inside quotes). */
function splitRecord(text: string, delimiter: string): string[] {
  if (!text.includes('"')) return text.split(delimiter);
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Push text in chunks of any size; rows come out through `onRow`. */
export class DelimitedParser {
  private carry = '';
  private record = '';
  private quotes = 0;
  private header: string[] | null = null;
  private delimiter: string | undefined;
  /** Data rows emitted so far. */
  rows = 0;

  constructor(
    private readonly onRow: (row: DelimitedRow) => void,
    opts: DelimitedOptions = {},
  ) {
    this.delimiter = opts.delimiter;
  }

  push(chunk: string): void {
    this.carry += chunk;
    let start = 0;
    for (let nl = this.carry.indexOf('\n'); nl !== -1; nl = this.carry.indexOf('\n', start)) {
      this.line(this.carry.slice(start, nl));
      start = nl + 1;
    }
    this.carry = this.carry.slice(start);
  }

  /** Flushes the last line; returns the number of data rows. */
  end(): number {
    if (this.carry !== '') this.line(this.carry);
    this.carry = '';
    if (this.record !== '') this.emit(this.record);
    this.record = '';
    return this.rows;
  }

  /** Column names of the file (normalized), once the header was read. */
  get columns(): string[] {
    return this.header ?? [];
  }

  private line(raw: string): void {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    this.record = this.record === '' && this.quotes === 0 ? text : `${this.record}\n${text}`;
    this.quotes += count(text, '"');
    if (this.quotes % 2 === 0) {
      const record = this.record;
      this.record = '';
      this.quotes = 0;
      this.emit(record);
    }
  }

  private emit(record: string): void {
    if (this.header === null) {
      if (record.trim() === '') return;
      const first = record.replace(/^﻿/, '');
      this.delimiter ??= first.includes('\t') ? '\t' : first.includes(',') ? ',' : first.includes(';') ? ';' : '\t';
      this.header = splitRecord(first, this.delimiter).map(normalizeHeader);
      return;
    }
    if (record.trim() === '') return;
    const values = splitRecord(record, this.delimiter!);
    const row: DelimitedRow = {};
    for (let i = 0; i < this.header.length; i++) row[this.header[i]!] = (values[i] ?? '').trim();
    this.rows++;
    this.onRow(row);
  }
}

/** The first of `names` (normalized like headers) that the row has, as a string ('' when none). */
export function column(row: DelimitedRow, ...names: string[]): string {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined) return v;
  }
  return '';
}

/** A number from a report cell (`1,234`, `12.5%` → 12.5, empty → null). */
export function cellNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const t = value.replace(/[,\s%]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Decodes UTF-16 bytes across chunk boundaries (independent of the runtime's TextDecoder labels). */
class Utf16Decoder {
  private odd: number | null = null;
  constructor(private readonly littleEndian: boolean) {}

  decode(bytes: Uint8Array): string {
    let start = 0;
    const units: number[] = [];
    let out = '';
    if (this.odd !== null && bytes.length > 0) {
      units.push(this.littleEndian ? this.odd | (bytes[0]! << 8) : (this.odd << 8) | bytes[0]!);
      this.odd = null;
      start = 1;
    }
    for (let i = start; i + 1 < bytes.length; i += 2) {
      units.push(this.littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
      if (units.length >= 8192) {
        out += String.fromCharCode(...units);
        units.length = 0;
      }
    }
    if ((bytes.length - start) % 2 === 1) this.odd = bytes[bytes.length - 1]!;
    return out + String.fromCharCode(...units);
  }
}

/**
 * Reads a delimited file from a byte stream: un-gzips it when it starts with the gzip magic bytes
 * (some servers already decompress), decodes UTF-8 or UTF-16 by byte order mark, and parses it.
 * Returns the number of data rows.
 */
/** Largest ZIP archive read (whole, since its sizes are at its end). Google Play's earnings files are far smaller. */
const MAX_ZIP_BYTES = 64 * 1024 * 1024;

async function readAll(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const parts = [head];
  let size = head.length;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > MAX_ZIP_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('ZIP archive too large');
    }
    parts.push(next.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The first `.csv` file of a ZIP archive (stored or deflated), as a stream. Reads the central
 * directory, so archives written with data descriptors work too. Web standard APIs only.
 */
export function unzipFirstCsv(zip: Uint8Array): ReadableStream<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last 0x06054b50 within the trailing 64 KiB comment window.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const entries = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  for (let n = 0; n < entries && at + 46 <= zip.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.csv$/i.test(name)) continue;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('broken ZIP archive');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + compressed);
    const raw = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    if (method === 0) return raw;
    if (method === 8)
      return raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    throw new Error(`unsupported ZIP compression method ${method}`);
  }
  throw new Error('no CSV file in the ZIP archive');
}

export async function readDelimited(
  body: ReadableStream<Uint8Array>,
  onRow: (row: DelimitedRow) => void,
  opts: DelimitedOptions = {},
): Promise<number> {
  let reader = body.getReader();
  let first = await reader.read();
  if (
    !first.done &&
    first.value.length >= 4 &&
    first.value[0] === 0x50 &&
    first.value[1] === 0x4b &&
    first.value[2] === 0x03 &&
    first.value[3] === 0x04
  ) {
    // A ZIP archive (Google Play's financial reports): its sizes are at the end, so read it whole.
    return readDelimited(unzipFirstCsv(await readAll(first.value, reader)), onRow, opts);
  }
  if (!first.done && first.value.length >= 2 && first.value[0] === 0x1f && first.value[1] === 0x8b) {
    // Re-assemble the stream with the chunk already read, then decompress it.
    const head = first.value;
    const rest = reader;
    const joined = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
      },
      async pull(controller) {
        const next = await rest.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel(reason) {
        return rest.cancel(reason);
      },
    });
    reader = joined.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
    first = await reader.read();
  }
  const parser = new DelimitedParser(onRow, opts);
  if (first.done) return parser.end();
  let chunk = first.value;
  let decode: (bytes: Uint8Array) => string;
  let flush = () => '';
  if (chunk.length >= 2 && chunk[0] === 0xff && chunk[1] === 0xfe) {
    const d = new Utf16Decoder(true);
    decode = (b) => d.decode(b);
    chunk = chunk.subarray(2);
  } else if (chunk.length >= 2 && chunk[0] === 0xfe && chunk[1] === 0xff) {
    const d = new Utf16Decoder(false);
    decode = (b) => d.decode(b);
    chunk = chunk.subarray(2);
  } else {
    const d = new TextDecoder('utf-8');
    decode = (b) => d.decode(b, { stream: true });
    flush = () => d.decode();
  }
  parser.push(decode(chunk));
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    parser.push(decode(next.value));
  }
  parser.push(flush());
  return parser.end();
}
