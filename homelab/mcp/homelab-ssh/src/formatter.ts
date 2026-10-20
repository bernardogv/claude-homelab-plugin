import stripAnsiLib from 'strip-ansi';

export function stripAnsi(text: string): string {
  return stripAnsiLib(text);
}

export function truncateOutput(
  output: string,
  maxLines: number = 200,
  headLines: number = 50,
  tailLines: number = 50
): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return output;

  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const truncated = lines.length - headLines - tailLines;

  return [...head, `\n[... ${truncated} lines truncated ...]\n`, ...tail].join('\n');
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

function cleanOutput(text: string): string {
  return collapseBlankLines(stripAnsi(text.trimEnd()));
}

export function formatResponse(
  node: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  durationSec: number
): string {
  const parts: string[] = [];

  parts.push(`[NODE: ${node}] [EXIT: ${exitCode}] [DURATION: ${durationSec.toFixed(1)}s]`);
  parts.push('');
  parts.push('--- OUTPUT ---');
  parts.push(truncateOutput(cleanOutput(stdout)));

  if (stderr.trim()) {
    parts.push('');
    parts.push('--- STDERR ---');
    parts.push(cleanOutput(stderr));
  }

  return parts.join('\n');
}

export function formatError(
  node: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  durationSec: number
): string {
  const parts: string[] = [];

  parts.push(`[NODE: ${node}] [FAILED] [EXIT: ${exitCode}] [DURATION: ${durationSec.toFixed(1)}s]`);

  if (stderr.trim()) {
    parts.push('');
    parts.push('--- STDERR ---');
    parts.push(cleanOutput(stderr));
  }

  if (stdout.trim()) {
    parts.push('');
    parts.push('--- OUTPUT ---');
    parts.push(truncateOutput(cleanOutput(stdout)));
  }

  return parts.join('\n');
}
