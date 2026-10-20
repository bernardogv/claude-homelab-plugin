import { execFile } from 'node:child_process';
import { getNode } from './nodes.js';
import { isCommandBlocked, isPathAllowedForWrite, isPathAllowedForRead, isUrlAllowed, isValidFileMode } from './guardrails.js';
import { formatResponse, formatError } from './formatter.js';

interface SshResult {
  content: string;
  isError: boolean;
}

export async function sshExec(
  node: string,
  command: string,
  timeoutSec: number = 60
): Promise<SshResult> {
  const blocked = isCommandBlocked(command);
  if (blocked) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nCommand blocked by safety guardrails: "${command}"`,
      isError: true,
    };
  }

  const nodeConfig = getNode(node);
  const clampedTimeout = Math.min(timeoutSec, 300);
  const warnings: string[] = [];
  if (timeoutSec > 300) {
    warnings.push(`[NOTE: timeout clamped from ${timeoutSec}s to 300s]`);
  }

  const start = performance.now();

  return new Promise((resolve) => {
    execFile(
      'ssh',
      [nodeConfig.sshAlias, command],
      { timeout: clampedTimeout * 1000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const durationSec = (performance.now() - start) / 1000;
        const exitCode = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ? -1
          : (error as any)?.status ?? (error ? 1 : 0);

        let content: string;
        if (error?.killed) {
          content = `[NODE: ${node}] [TIMEOUT] [DURATION: ${durationSec.toFixed(1)}s]\n\n--- ERROR ---\nCommand timed out after ${clampedTimeout}s`;
          if (stdout.trim()) {
            content += `\n\n--- PARTIAL OUTPUT ---\n${stdout.trim()}`;
          }
        } else if (exitCode !== 0) {
          content = formatError(node, exitCode, stdout, stderr, durationSec);
        } else {
          content = formatResponse(node, 0, stdout, stderr, durationSec);
        }

        if (warnings.length > 0) {
          content = warnings.join('\n') + '\n\n' + content;
        }

        resolve({ content, isError: exitCode !== 0 });
      }
    );
  });
}

export async function sshFileRead(
  node: string,
  path: string,
  maxLines: number = 500,
  startLine: number = 1
): Promise<SshResult> {
  if (!isPathAllowedForRead(path)) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nPath rejected: "${path}". Must be absolute with no ".." segments.`,
      isError: true,
    };
  }

  const quotedPath = path.replace(/'/g, "'\\''");
  const endLine = startLine + maxLines - 1;
  const cmd = startLine > 1
    ? `sed -n '${startLine},${endLine}p' '${quotedPath}'`
    : `head -n ${maxLines} '${quotedPath}'`;
  return sshExec(node, cmd);
}

export async function sshFileWrite(
  node: string,
  path: string,
  content: string,
  mode?: string
): Promise<SshResult> {
  if (!isPathAllowedForWrite(path)) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nWrite rejected: "${path}". Only /home/bernardogv/ and /tmp/ are allowed.`,
      isError: true,
    };
  }

  if (mode !== undefined && !isValidFileMode(mode)) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nInvalid mode: "${mode}". Must be octal (e.g. "755", "0644").`,
      isError: true,
    };
  }

  const quotedPath = path.replace(/'/g, "'\\''");
  const checkExists = `test -f '${quotedPath}' && echo "EXISTS" || echo "NEW"`;
  const { content: existsResult } = await sshExec(node, checkExists);
  const overwrote = existsResult.includes('EXISTS');

  const writeCmd = `cat > '${quotedPath}'`;
  const nodeConfig = getNode(node);
  const start = performance.now();

  return new Promise((resolve) => {
    const child = execFile(
      'ssh',
      [nodeConfig.sshAlias, writeCmd],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      async (error, stdout, stderr) => {
        const durationSec = (performance.now() - start) / 1000;

        if (error) {
          resolve({
            content: formatError(node, 1, stdout, stderr, durationSec),
            isError: true,
          });
          return;
        }

        const notes: string[] = [];
        if (overwrote) notes.push('[NOTE: overwrote existing file]');

        // Apply chmod if mode specified
        if (mode) {
          await new Promise<void>((chmodResolve) => {
            execFile('ssh', [nodeConfig.sshAlias, `chmod ${mode} '${quotedPath}'`], () => chmodResolve());
          });
        }

        let result = formatResponse(node, 0, `File written: ${path} (${content.length} bytes)`, stderr, durationSec);
        if (notes.length) result = notes.join('\n') + '\n\n' + result;

        resolve({ content: result, isError: false });
      }
    );

    child.stdin?.write(content);
    child.stdin?.end();
  });
}

export async function sshFileDownload(
  node: string,
  url: string,
  destPath: string
): Promise<SshResult> {
  if (!isPathAllowedForWrite(destPath)) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nWrite rejected: "${destPath}". Only /home/bernardogv/ and /tmp/ are allowed.`,
      isError: true,
    };
  }

  if (!isUrlAllowed(url)) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nURL rejected: "${url}". Only http:// and https:// are allowed.`,
      isError: true,
    };
  }

  const quotedUrl = url.replace(/'/g, "'\\''");
  const quotedDest = destPath.replace(/'/g, "'\\''");
  // --proto limits curl to http(s); `--` stops a leading-dash URL from smuggling curl flags.
  // Note: destPath is NOT interpolated raw into the shell — only the single-quote-escaped
  // quotedDest is used, and `ls -lh` echoes the path back safely.
  const cmd = `curl -fSL --proto '=http,https' --max-time 120 -o '${quotedDest}' -- '${quotedUrl}' && ls -lh '${quotedDest}'`;
  return sshExec(node, cmd, 150);
}

export async function sshTail(
  node: string,
  path: string,
  lines: number = 50
): Promise<SshResult> {
  if (!isPathAllowedForRead(path)) {
    return {
      content: `[NODE: ${node}] [BLOCKED]\n\n--- ERROR ---\nPath rejected: "${path}". Must be absolute with no ".." segments.`,
      isError: true,
    };
  }

  const quotedPath = path.replace(/'/g, "'\\''");
  return sshExec(node, `tail -n ${lines} '${quotedPath}'`);
}

export async function sshNodeProcesses(
  node: string,
  filter?: string
): Promise<SshResult> {
  const quotedFilter = filter ? filter.replace(/'/g, "'\\''") : '';
  const cmd = filter
    ? `ps aux --sort=-%mem | head -1 && ps aux --sort=-%mem | grep -i '${quotedFilter}' | grep -v grep | head -30`
    : `ps aux --sort=-%mem | head -21`;
  return sshExec(node, cmd, 15);
}

export async function sshNodeStatus(node: string): Promise<string> {
  const nodeConfig = getNode(node);
  const isMac = node === 'mac-mini';
  const hasGpu = node === 'spark';

  let cmd: string;
  if (!isMac) {
    cmd = 'echo "---UPTIME---" && uptime -s && echo "---LOAD---" && cat /proc/loadavg && echo "---MEM---" && free -b && echo "---DISK---" && df -B1 /';
    if (hasGpu) {
      cmd += ' && echo "---GPU---" && nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null && echo "---GPU-PROCS---" && nvidia-smi --query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || echo "GPU: stats unavailable"';
    }
  } else {
    cmd = 'echo "---UPTIME---" && uptime && echo "---MEM---" && vm_stat && echo "---DISK---" && df -k /';
  }

  const result = await sshExec(node, cmd, 10);
  return result.content;
}
