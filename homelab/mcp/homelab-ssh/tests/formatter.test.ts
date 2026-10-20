import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatResponse, formatError, stripAnsi, truncateOutput } from '../src/formatter.js';

describe('stripAnsi', () => {
  it('removes color codes', () => {
    assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  });

  it('passes plain text through', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });
});

describe('truncateOutput', () => {
  it('returns short output unchanged', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    assert.equal(truncateOutput(lines, 200), lines);
  });

  it('truncates long output keeping head and tail', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const result = truncateOutput(lines, 200);
    assert.ok(result.includes('line 0'));
    assert.ok(result.includes('line 299'));
    assert.ok(result.includes('[...'));
    assert.ok(result.includes('lines truncated'));
  });
});

describe('formatResponse', () => {
  it('formats successful response with envelope', () => {
    const result = formatResponse('spark', 0, 'hello world', '', 1.2);
    assert.ok(result.includes('[NODE: spark]'));
    assert.ok(result.includes('[EXIT: 0]'));
    assert.ok(result.includes('[DURATION: 1.2s]'));
    assert.ok(result.includes('hello world'));
  });

  it('omits stderr section when empty', () => {
    const result = formatResponse('pi', 0, 'output', '', 0.5);
    assert.ok(!result.includes('--- STDERR ---'));
  });

  it('includes stderr when present', () => {
    const result = formatResponse('pi', 0, 'output', 'warning here', 0.5);
    assert.ok(result.includes('--- STDERR ---'));
    assert.ok(result.includes('warning here'));
  });

  it('collapses consecutive blank lines', () => {
    const result = formatResponse('spark', 0, 'a\n\n\n\n\nb', '', 0.1);
    assert.ok(!result.includes('\n\n\n'));
  });
});

describe('formatError', () => {
  it('puts FAILED marker and stderr before stdout', () => {
    const result = formatError('spark', 1, 'partial output', 'error msg', 0.3);
    assert.ok(result.includes('[FAILED]'));
    const stderrPos = result.indexOf('error msg');
    const stdoutPos = result.indexOf('partial output');
    assert.ok(stderrPos < stdoutPos, 'stderr should come before stdout');
  });
});
