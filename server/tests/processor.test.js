const { processCsv, processTxt, processFile, parseCsv } = require('../processor');
const csv = text => processCsv(Buffer.from(text));
const failure = fn => { try { fn(); } catch (error) { return error.code; } return null; };

test('analyses the attendance example exactly as documented', () => {
  expect(csv('name,roll_no,attendance\nAditi,16010123020,Present\nRahul,16010123021,\nAditi,16010123020,Present\n'))
    .toEqual({ rowCount: 3, columnCount: 3, headers: ['name', 'roll_no', 'attendance'], missingValues: 1, duplicateRows: 1 });
});
test('handles quoted commas, escaped quotes, line breaks, CRLF, BOM and blank lines', () => {
  expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",z').map(row => row.fields)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']]);
  expect(csv('﻿id,note\n1,"two\nlines"\n2,ok').rowCount).toBe(2);
});
test.each([
  ['a,b\n1,2,3', 'MALFORMED_CSV'], ['a,b\n"1,2', 'MALFORMED_CSV'], ['a,b\n"1"x,2', 'MALFORMED_CSV'], ['a,b\n1"2",3', 'MALFORMED_CSV'],
  [',\n1,2', 'MALFORMED_CSV'], ['', 'EMPTY_FILE'], ['  \n \n', 'EMPTY_FILE']
])('rejects bad CSV %j with %s', (text, code) => expect(failure(() => csv(text))).toBe(code));
test('reports the line of a malformed row', () => expect(() => csv('a,b\n1,2\n3')).toThrow('Line 3: expected 2 columns but found 1.'));
test('rejects binary and invalid UTF-8 content as corrupted', () => {
  expect(failure(() => processCsv(Buffer.from([0x61, 0x00, 0x62])))).toBe('CORRUPTED_FILE');
  expect(failure(() => processTxt(Buffer.from([0xff, 0xfe, 0x41])))).toBe('CORRUPTED_FILE');
});
test('counts lines, words, characters and repeated words in text', () => {
  expect(processTxt(Buffer.from('The cat saw the dog.\nThe dog ran — café café!\n'))).toEqual({
    lineCount: 2, wordCount: 11, characterCount: 46, topWords: [{ word: 'the', count: 3 }, { word: 'café', count: 2 }, { word: 'dog', count: 2 }]
  });
  expect(processTxt(Buffer.from('one line without newline')).lineCount).toBe(1);
});
test('dispatches by file type', () => {
  expect(processFile('txt', Buffer.from('hi')).wordCount).toBe(1);
  expect(failure(() => processFile('pdf', Buffer.from('x')))).toBe('UNSUPPORTED_FILE_TYPE');
});
