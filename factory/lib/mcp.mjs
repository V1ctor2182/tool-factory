import { createInterface } from 'node:readline';
import { validate } from './manifest.mjs';
import { argv } from './registry.mjs';
import { invoke } from './runs.mjs';

const PROTOCOL = '2025-06-18';

export function tools(entries) {
  return entries.flatMap((entry) =>
    entry.manifest.verbs.map((verb) => ({ name: `${entry.name}_${verb.name}`, entry, verb })),
  );
}

async function call(tool, input) {
  const errors = validate({ ...tool.verb.input, additionalProperties: false }, input);
  if (errors.length) return { content: [{ type: 'text', text: `Invalid arguments: ${errors.join('; ')}` }], isError: true };
  const { code, stdout, stderr } = await invoke(tool.entry, tool.verb, argv(tool.entry, tool.verb, input), 'mcp');
  const text = stdout.trim() || stderr.trim() || `${tool.entry.name} exited ${code} with no output`;
  return { content: [{ type: 'text', text }], isError: code !== 0 };
}

export function serve(entries, { input = process.stdin, output = process.stdout } = {}) {
  const byName = new Map(tools(entries).map((tool) => [tool.name, tool]));
  const send = (message) => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const methods = {
    initialize: (params) => ({
      protocolVersion: params?.protocolVersion ?? PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: `factory ${entries.map((e) => e.name).join(' ')}`, version: '1' },
    }),
    ping: () => ({}),
    'tools/list': () => ({
      tools: [...byName.values()].map(({ name, verb }) => ({ name, description: verb.description, inputSchema: verb.input })),
    }),
    'tools/call': (params) => {
      const tool = byName.get(params?.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 });
      return call(tool, params.arguments ?? {});
    },
  };
  const lines = createInterface({ input });
  lines.on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (message.id === undefined) return;
    const method = methods[message.method];
    if (!method) return send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
    try {
      send({ id: message.id, result: await method(message.params) });
    } catch (e) {
      send({ id: message.id, error: { code: e.code ?? -32603, message: e.message } });
    }
  });
  return new Promise((done) => lines.on('close', done));
}
