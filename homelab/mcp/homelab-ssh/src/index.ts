import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getNodeNames, formatNodeList, loadNodes } from './nodes.js';
import { sshExec, sshFileRead, sshFileWrite, sshFileDownload, sshTail, sshNodeProcesses, sshNodeStatus } from './ssh.js';

const server = new McpServer({
  name: 'homelab-ssh',
  version: '1.0.0',
});

const nodeNames = getNodeNames();
if (nodeNames.length === 0) {
  throw new Error('No nodes configured in config/nodes.json');
}
const nodeEnum = z.enum(nodeNames as [string, ...string[]]);
const nodeEnumWithAll = z.enum(['all', ...nodeNames] as [string, ...string[]]);

// Tool: ssh_exec
server.tool(
  'ssh_exec',
  'Execute a command on a homelab node via SSH. Returns structured output with exit code and duration.',
  {
    node: nodeEnum.describe('Target homelab node'),
    command: z.string().describe('Command to execute on the remote node'),
    timeout: z.number().optional().default(60).describe('Timeout in seconds (max 300)'),
  },
  async ({ node, command, timeout }) => {
    const result = await sshExec(node, command, timeout);
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  }
);

// Tool: list_nodes
server.tool(
  'list_nodes',
  'List all configured homelab nodes with their roles, IPs, and hardware specs. No SSH connection required.',
  {},
  async () => {
    const text = formatNodeList();
    return { content: [{ type: 'text' as const, text }] };
  }
);

// Tool: node_status
server.tool(
  'node_status',
  'Check health of homelab nodes. Returns uptime, load, memory, disk usage. Includes GPU stats for spark.',
  {
    node: nodeEnumWithAll.optional().default('all').describe('Node to check, or "all" for all nodes'),
  },
  async ({ node }) => {
    const nodes = node === 'all' ? getNodeNames() : [node];
    const parts: string[] = ['=== HOMELAB STATUS ===', ''];

    for (const n of nodes) {
      try {
        const status = await sshNodeStatus(n);
        parts.push(status);
        parts.push('');
      } catch (err) {
        parts.push(`[${n}] OFFLINE`);
        parts.push(`  Error: ${err instanceof Error ? err.message : String(err)}`);
        parts.push('');
      }
    }

    return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
  }
);

// Tool: file_read
server.tool(
  'file_read',
  'Read a file from a homelab node. Supports offset for reading specific sections of large files.',
  {
    node: nodeEnum.describe('Target homelab node'),
    path: z.string().describe('Absolute path to the file on the remote node'),
    max_lines: z.number().optional().default(500).describe('Maximum lines to read'),
    start_line: z.number().optional().default(1).describe('Line number to start reading from (1-based)'),
  },
  async ({ node, path, max_lines, start_line }) => {
    const result = await sshFileRead(node, path, max_lines, start_line);
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  }
);

// Tool: file_write
server.tool(
  'file_write',
  'Write content to a file on a homelab node. Only paths under /home/bernardogv/ and /tmp/ are allowed.',
  {
    node: nodeEnum.describe('Target homelab node'),
    path: z.string().describe('Absolute path on the remote node'),
    content: z.string().describe('File content to write'),
    mode: z.string().optional().describe('File permissions (e.g., "755")'),
  },
  async ({ node, path, content, mode }) => {
    const result = await sshFileWrite(node, path, content, mode);
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  }
);

// Tool: file_download
server.tool(
  'file_download',
  'Download a file from a URL to a homelab node. Wraps curl. Only paths under /home/bernardogv/ and /tmp/ are allowed.',
  {
    node: nodeEnum.describe('Target homelab node'),
    url: z.string().describe('URL to download from'),
    dest_path: z.string().describe('Absolute destination path on the remote node'),
  },
  async ({ node, url, dest_path }) => {
    const result = await sshFileDownload(node, url, dest_path);
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  }
);

// Tool: ssh_tail
server.tool(
  'ssh_tail',
  'Read the last N lines of a file on a homelab node. Useful for logs and monitoring output.',
  {
    node: nodeEnum.describe('Target homelab node'),
    path: z.string().describe('Absolute path to the file on the remote node'),
    lines: z.number().optional().default(50).describe('Number of lines from the end to read'),
  },
  async ({ node, path, lines }) => {
    const result = await sshTail(node, path, lines);
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  }
);

// Tool: node_processes
server.tool(
  'node_processes',
  'List top processes on a homelab node sorted by memory usage. Optional filter to search for specific processes.',
  {
    node: nodeEnum.describe('Target homelab node'),
    filter: z.string().optional().describe('Filter processes by name (case-insensitive grep)'),
  },
  async ({ node, filter }) => {
    const result = await sshNodeProcesses(node, filter);
    return {
      content: [{ type: 'text' as const, text: result.content }],
      isError: result.isError,
    };
  }
);

// Start server
async function main() {
  loadNodes(); // Validate config at startup
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Homelab SSH MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
