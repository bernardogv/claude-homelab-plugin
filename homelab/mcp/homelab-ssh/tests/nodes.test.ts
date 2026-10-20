import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadNodes, getNode, getNodeNames, formatNodeList } from '../src/nodes.js';

describe('loadNodes', () => {
  it('loads nodes from config file', () => {
    const nodes = loadNodes();
    assert.ok(nodes.spark);
    assert.ok(nodes.pi);
    assert.ok(nodes.framework);
    assert.ok(nodes['mac-mini']);
  });

  it('each node has required fields', () => {
    const nodes = loadNodes();
    for (const [name, node] of Object.entries(nodes)) {
      assert.ok(node.sshAlias, `${name} missing sshAlias`);
      assert.ok(node.role, `${name} missing role`);
      assert.ok(node.ip, `${name} missing ip`);
      assert.ok(node.hardware, `${name} missing hardware`);
      assert.ok(node.hardware.cores, `${name} missing cores`);
      assert.ok(node.hardware.ram, `${name} missing ram`);
      assert.ok(node.hardware.arch, `${name} missing arch`);
    }
  });
});

describe('getNode', () => {
  it('returns node by name', () => {
    const node = getNode('spark');
    assert.equal(node.sshAlias, 'spark');
    assert.equal(node.role, 'GPU/ML');
  });

  it('throws for unknown node', () => {
    assert.throws(() => getNode('nonexistent'), /Unknown node/);
  });
});

describe('getNodeNames', () => {
  it('returns all node names', () => {
    const names = getNodeNames();
    assert.deepEqual(names.sort(), ['framework', 'mac-mini', 'nas', 'pi', 'spark', 'spark2', 'strix']);
  });
});

describe('formatNodeList', () => {
  it('produces formatted table string', () => {
    const result = formatNodeList();
    assert.ok(result.includes('=== HOMELAB NODES ==='));
    assert.ok(result.includes('spark'));
    assert.ok(result.includes('GPU/ML'));
    assert.ok(result.includes('100.64.0.11'));
  });
});
