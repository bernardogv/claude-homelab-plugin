import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCommandBlocked, isPathAllowedForWrite, isPathAllowedForRead, isUrlAllowed, isValidFileMode } from '../src/guardrails.js';

describe('isCommandBlocked', () => {
  it('blocks rm -rf /', () => {
    assert.ok(isCommandBlocked('rm -rf /'));
  });

  it('blocks rm -rf /* variant', () => {
    assert.ok(isCommandBlocked('rm -rf /*'));
  });

  it('blocks rm -rf ~', () => {
    assert.ok(isCommandBlocked('rm -rf ~'));
  });

  it('blocks shutdown', () => {
    assert.ok(isCommandBlocked('sudo shutdown -h now'));
  });

  it('blocks reboot', () => {
    assert.ok(isCommandBlocked('reboot'));
  });

  it('blocks poweroff', () => {
    assert.ok(isCommandBlocked('poweroff'));
  });

  it('blocks halt', () => {
    assert.ok(isCommandBlocked('halt'));
  });

  it('blocks mkfs', () => {
    assert.ok(isCommandBlocked('mkfs.ext4 /dev/sda1'));
  });

  it('blocks dd if=', () => {
    assert.ok(isCommandBlocked('dd if=/dev/zero of=/dev/sda'));
  });

  it('blocks fdisk', () => {
    assert.ok(isCommandBlocked('fdisk /dev/sda'));
  });

  it('blocks recursive chmod from root', () => {
    assert.ok(isCommandBlocked('chmod -R 777 /'));
  });

  it('blocks recursive chown from root', () => {
    assert.ok(isCommandBlocked('chown -R nobody:nobody /'));
  });

  it('allows safe commands', () => {
    assert.ok(!isCommandBlocked('ls -la'));
    assert.ok(!isCommandBlocked('docker ps'));
    assert.ok(!isCommandBlocked('cat /etc/hostname'));
    assert.ok(!isCommandBlocked('rm /tmp/test.txt'));
    assert.ok(!isCommandBlocked('systemctl status nginx'));
  });
});

describe('isPathAllowedForWrite', () => {
  it('allows /home/bernardogv/ paths', () => {
    assert.ok(isPathAllowedForWrite('/home/bernardogv/project/file.py'));
  });

  it('allows /tmp/ paths', () => {
    assert.ok(isPathAllowedForWrite('/tmp/test.txt'));
  });

  it('rejects /etc/ paths', () => {
    assert.ok(!isPathAllowedForWrite('/etc/sudoers'));
  });

  it('rejects /usr/ paths', () => {
    assert.ok(!isPathAllowedForWrite('/usr/local/bin/evil'));
  });

  it('rejects relative paths', () => {
    assert.ok(!isPathAllowedForWrite('relative/path.txt'));
  });

  it('rejects paths with .. traversal', () => {
    assert.ok(!isPathAllowedForWrite('/home/bernardogv/../root/.ssh/id_rsa'));
  });

  it('rejects shell metacharacters (command injection via path)', () => {
    assert.ok(!isPathAllowedForWrite('/tmp/x";rm -rf ~ #'));
    assert.ok(!isPathAllowedForWrite('/tmp/$(reboot)'));
    assert.ok(!isPathAllowedForWrite('/tmp/`id`'));
    assert.ok(!isPathAllowedForWrite('/home/bernardogv/a|b'));
  });

  it('still allows normal paths', () => {
    assert.ok(isPathAllowedForWrite('/home/bernardogv/project/model-v2.gguf'));
    assert.ok(isPathAllowedForWrite('/tmp/download_123.tar.gz'));
  });
});

describe('isPathAllowedForRead', () => {
  it('allows any absolute path', () => {
    assert.ok(isPathAllowedForRead('/var/log/syslog'));
  });

  it('rejects relative paths', () => {
    assert.ok(!isPathAllowedForRead('relative/path.txt'));
  });

  it('rejects paths with .. traversal', () => {
    assert.ok(!isPathAllowedForRead('/home/../etc/shadow'));
  });
});

describe('isUrlAllowed', () => {
  it('allows http and https URLs', () => {
    assert.ok(isUrlAllowed('https://example.com/model.gguf'));
    assert.ok(isUrlAllowed('http://192.0.2.10:8080/file'));
  });

  it('rejects curl-flag smuggling (leading dash)', () => {
    assert.ok(!isUrlAllowed('--config=/etc/passwd'));
    assert.ok(!isUrlAllowed('-O'));
  });

  it('rejects non-http(s) schemes (SSRF/exfil vectors)', () => {
    assert.ok(!isUrlAllowed('file:///etc/shadow'));
    assert.ok(!isUrlAllowed('dict://localhost:11211/'));
    assert.ok(!isUrlAllowed('gopher://evil/'));
    assert.ok(!isUrlAllowed('scp://host/path'));
  });
});

describe('isValidFileMode', () => {
  it('allows 3- and 4-digit octal modes', () => {
    assert.ok(isValidFileMode('755'));
    assert.ok(isValidFileMode('644'));
    assert.ok(isValidFileMode('0600'));
  });

  it('rejects command injection via mode', () => {
    assert.ok(!isValidFileMode('777; rm -rf ~ #'));
    assert.ok(!isValidFileMode('755 && curl evil'));
    assert.ok(!isValidFileMode('-R'));
  });

  it('rejects non-octal and out-of-range digits', () => {
    assert.ok(!isValidFileMode('999'));
    assert.ok(!isValidFileMode('abc'));
    assert.ok(!isValidFileMode(''));
  });
});
