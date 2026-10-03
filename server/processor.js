// Pure file analysis used by the worker. Failures throw a ProcessingError whose code becomes the job's failure reason.
class ProcessingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Reject binary or non-UTF-8 content before parsing, so a corrupted upload fails with a clear reason.
function decode(buffer) {
  if (!buffer.length) throw new ProcessingError('EMPTY_FILE', 'The file is empty.');
  if (buffer.includes(0)) throw new ProcessingError('CORRUPTED_FILE', 'The file contains binary data and is not plain text.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { throw new ProcessingError('CORRUPTED_FILE', 'The file is not valid UTF-8 text.'); }
  text = text.replace(/^﻿/, '');
  if (!text.trim()) throw new ProcessingError('EMPTY_FILE', 'The file contains only whitespace.');
  return text;
}

// RFC 4180 parser: quoted fields may contain commas, quotes ("") and line breaks. Returns rows with their starting line numbers.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false, line = 1, rowLine = 1, quoteLine = 1;
  const endField = () => { row.push(field); field = ''; afterQuote = false; };
  const endRow = () => { endField(); rows.push({ line: rowLine, fields: row }); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; afterQuote = true; }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow(); line += 1; rowLine = line;
    } else if (afterQuote) throw new ProcessingError('MALFORMED_CSV', `Line ${line}: unexpected text after a closing quote.`);
    else if (char === '"') {
      if (field.trim()) throw new ProcessingError('MALFORMED_CSV', `Line ${line}: a quote appears inside an unquoted field.`);
      field = ''; quoted = true; quoteLine = line;
    } else field += char;
  }
  if (quoted) throw new ProcessingError('MALFORMED_CSV', `Line ${quoteLine}: a quoted field is never closed.`);
  if (field || row.length) endRow();
  // Blank lines carry no data and are skipped.
  return rows.filter(entry => !(entry.fields.length === 1 && entry.fields[0].trim() === ''));
}

function processCsv(buffer) {
  const rows = parseCsv(decode(buffer));
  if (!rows.length) throw new ProcessingError('EMPTY_FILE', 'The CSV file has no rows.');
  const headers = rows[0].fields.map(name => name.trim());
  if (headers.every(name => !name)) throw new ProcessingError('MALFORMED_CSV', 'Line 1: the header row has no column names.');
  const data = rows.slice(1), seen = new Set();
  let missingValues = 0, duplicateRows = 0;
  for (const { line, fields } of data) {
    if (fields.length !== headers.length) throw new ProcessingError('MALFORMED_CSV', `Line ${line}: expected ${headers.length} columns but found ${fields.length}.`);
    missingValues += fields.filter(value => value.trim() === '').length;
    const key = JSON.stringify(fields.map(value => value.trim()));
    if (seen.has(key)) duplicateRows += 1; else seen.add(key);
  }
  return { rowCount: data.length, columnCount: headers.length, headers, missingValues, duplicateRows };
}

function processTxt(buffer) {
  const text = decode(buffer);
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const counts = new Map();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) {
    const word = raw.replace(/^'+|'+$/g, '');
    if (word) counts.set(word, (counts.get(word) || 0) + 1);
  }
  const topWords = [...counts].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([word, count]) => ({ word, count }));
  return { lineCount: lines.length, wordCount: (text.match(/\S+/g) || []).length, characterCount: [...text].length, topWords };
}

const PROCESSORS = { csv: processCsv, txt: processTxt };
function processFile(fileType, buffer) {
  const processor = PROCESSORS[fileType];
  if (!processor) throw new ProcessingError('UNSUPPORTED_FILE_TYPE', `Files of type .${fileType} are not supported.`);
  return processor(buffer);
}

module.exports = { ProcessingError, parseCsv, processCsv, processTxt, processFile, SUPPORTED_TYPES: Object.keys(PROCESSORS) };
