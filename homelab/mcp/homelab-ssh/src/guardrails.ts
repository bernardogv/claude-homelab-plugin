const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /rm\s+(-\w*)?r\w*\s+(-\w*\s+)*\//i,
  /rm\s+(-\w*)?r\w*\s+(-\w*\s+)*~/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\b(mkfs|fdisk|parted)\b/i,
  /\bdd\s+if=/i,
  /chmod\s+(-R|--recursive)\s+\d+\s+\//i,
  /chown\s+(-R|--recursive)\s+\S+\s+\//i,
  /:\(\)\s*\{.*\|.*&\s*\}\s*;/,
];

export function isCommandBlocked(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

const WRITE_ALLOWED_PREFIXES = ['/home/bernardogv/', '/tmp/'];

// Shell metacharacters that could break out of a quoted/echoed context on the remote shell.
const SHELL_METACHARS = /["'`$;&|<>\\\n\r()]/;

export function isPathAllowedForWrite(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  if (SHELL_METACHARS.test(path)) return false;
  return WRITE_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isPathAllowedForRead(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  return true;
}

// Only http(s) — rejects file://, dict://, gopher://, scp://, etc. (curl SSRF/exfil vectors).
export function isUrlAllowed(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// chmod mode: octal only (3-4 digits). Blocks injection via the unquoted mode arg.
export function isValidFileMode(mode: string): boolean {
  return /^[0-7]{3,4}$/.test(mode);
}
