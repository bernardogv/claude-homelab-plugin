import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface NodeHardware {
  cores: number;
  ram: string;
  arch: string;
  special?: string;
}

export interface NodeConfig {
  sshAlias: string;
  role: string;
  ip: string;
  hardware: NodeHardware;
}

export interface NodesConfig {
  nodes: Record<string, NodeConfig>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedNodes: Record<string, NodeConfig> | null = null;

export function loadNodes(): Record<string, NodeConfig> {
  if (cachedNodes) return cachedNodes;

  const configPath = resolve(__dirname, '..', 'config', 'nodes.json');
  const raw = readFileSync(configPath, 'utf-8');
  const config: NodesConfig = JSON.parse(raw);

  for (const [name, node] of Object.entries(config.nodes)) {
    if (!node.sshAlias || !node.role || !node.ip || !node.hardware) {
      throw new Error(`Invalid config for node "${name}": missing required fields`);
    }
    if (!node.hardware.cores || !node.hardware.ram || !node.hardware.arch) {
      throw new Error(`Invalid hardware config for node "${name}": missing cores, ram, or arch`);
    }
  }

  cachedNodes = config.nodes;
  return cachedNodes;
}

export function getNode(name: string): NodeConfig {
  const nodes = loadNodes();
  const node = nodes[name];
  if (!node) throw new Error(`Unknown node: "${name}". Available: ${Object.keys(nodes).join(', ')}`);
  return node;
}

export function getNodeNames(): string[] {
  return Object.keys(loadNodes());
}

export function formatNodeList(): string {
  const nodes = loadNodes();
  const lines: string[] = ['=== HOMELAB NODES ===', ''];

  for (const [name, node] of Object.entries(nodes)) {
    const hw = node.hardware;
    const special = hw.special ? `, ${hw.special}` : '';
    lines.push(
      `${name.padEnd(10)}| ${node.role.padEnd(11)}| ${node.ip.padEnd(17)}| ${hw.cores} cores, ${hw.ram} RAM${special}`
    );
  }

  return lines.join('\n');
}
