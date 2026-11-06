const DETAIL_LIMIT = 80;
export const NOTE_LIMIT = 200;
export const TOOL_ERROR_NOTE = 'The tool returned an error.';
const LIFECYCLE_STEPS = new Set(['ready for review', 'submitted']);
const ROLLUP = ['running', 'blocked', 'stalled', 'failed', 'pending', 'done'];

export const rollup = (states) => ROLLUP.find((state) => states.includes(state)) ?? 'pending';

export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const at = Date.parse(/(Z|[+-]\d\d(:?\d\d)?)$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(at) ? null : at;
}

export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
export const seconds = (ms, origin) => Math.round(ms - origin) / 1000;

const text = (field) => (input) => (typeof input[field] === 'string' && input[field] ? input[field].slice(0, DETAIL_LIMIT) : null);
const basename = (input) => (typeof input.file_path === 'string' ? input.file_path.split('/').pop().slice(0, DETAIL_LIMIT) || null : null);

function host(input) {
  try {
    return new URL(input.url).hostname || null;
  } catch {
    return null;
  }
}

// Leading VAR=value words hold secrets, quoted ones can hold spaces, and a path shows only its program.
// Anything that does not read as a program name is someone's data, so it is not shown.
function firstWord(input) {
  if (typeof input.command !== 'string') return null;
  const [word] = input.command.trim().replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)*/, '').split(/\s+/);
  const program = word?.split('/').pop().slice(0, DETAIL_LIMIT);
  return /^[\w.+-]+$/.test(program ?? '') ? program : null;
}

const lifecycle = (input) => (LIFECYCLE_STEPS.has(input.step) ? input.step : null);

const tool = (label, category, detail, fills = false) => ({ label, category, detail, fills });

const BROWSER = {
  tabs_context_mcp: tool('Check tab', 'browser'),
  tabs_context: tool('Check tab', 'browser'),
  navigate: tool('Open page', 'browser', host),
  form_input: tool('Fill field', 'browser', null, true),
  file_upload: tool('Upload file', 'browser', null, true),
  computer: tool('Click or type', 'browser', text('action')),
  find: tool('Find element', 'browser'),
  read_page: tool('Read page', 'browser'),
  get_page_text: tool('Read page', 'browser'),
  javascript_tool: tool('Run script', 'browser'),
};

const BACKEND = {
  mcp__applier__register_tab: tool('Register tab', 'backend'),
  mcp__applier__record_progress: tool('Record progress', 'backend', lifecycle),
  mcp__applier__lookup_answer: tool('Look up answer', 'backend'),
  mcp__applier__lookup_profile: tool('Read profile', 'backend'),
  mcp__applier__list_resumes: tool('List résumés', 'backend'),
  mcp__applier__select_resume: tool('Pick résumé', 'backend'),
  mcp__applier__get_notes: tool('Read site notes', 'backend'),
  mcp__applier__get_helper: tool('Load helper', 'backend'),
  mcp__applier__save_note: tool('Save note', 'backend'),
  mcp__applier__request_submit: tool('Request Submit', 'backend'),
  mcp__applier__record_readback: tool('Record read-back', 'backend'),
  mcp__applier__record_confirmation: tool('Record confirmation', 'backend'),
  mcp__applier__record_submit_outcome: tool('Record Submit outcome', 'backend'),
  mcp__applier__ask_user: tool('Ask you', 'human'),
  mcp__applier__report_blocker: tool('Report blocker', 'human', text('blocker_type')),
};

const BUILTIN = {
  Bash: tool('Run command', 'shell', firstWord),
  Read: tool('Read file', 'file', basename),
  Edit: tool('Edit file', 'file', basename),
  MultiEdit: tool('Edit file', 'file', basename),
  Write: tool('Write file', 'file', basename),
  NotebookEdit: tool('Edit notebook', 'file'),
  Grep: tool('Search files', 'file'),
  Glob: tool('Find files', 'file'),
  WebFetch: tool('Fetch page', 'browser', host),
  WebSearch: tool('Search web', 'browser'),
  Task: tool('Subagent', 'agent', text('description')),
  Agent: tool('Subagent', 'agent', text('description')),
  ToolSearch: tool('Load tools', 'shell'),
};

const BROWSER_PREFIXES = ['mcp__claude-in-chrome__', 'mcp__Claude_Browser__'];

// The short name is shown in a step's meta, the entry says how to label and detail it.
function lookup(name) {
  const browser = BROWSER_PREFIXES.find((prefix) => name.startsWith(prefix));
  if (browser) {
    const short = name.slice(browser.length);
    return { short, entry: BROWSER[short] ?? tool(short, 'browser') };
  }
  if (name.startsWith('mcp__')) {
    const short = name.split('__').slice(2).join('__') || name;
    return { short, entry: BACKEND[name] ?? tool(short, 'backend') };
  }
  return { short: name, entry: BUILTIN[name] ?? tool(name, 'backend') };
}

function detailOf(name, input) {
  const { detail } = lookup(name).entry;
  return detail ? detail(input && typeof input === 'object' ? input : {}) : null;
}

export function parseTranscript(content) {
  const calls = new Map();
  let first = null;
  let last = null;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const at = parseTime(record?.timestamp);
    if (at === null) continue;
    first ??= at;
    last = Math.max(last ?? at, at);
    const blocks = record.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (record.type === 'assistant' && block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        if (!calls.has(block.id)) calls.set(block.id, { id: block.id, name: block.name, detail: detailOf(block.name, block.input), parent: record.parent_tool_use_id ?? null, start: at, end: null, failed: false });
      } else if (record.type === 'user' && block?.type === 'tool_result') {
        const call = calls.get(block.tool_use_id);
        if (call && call.end === null) Object.assign(call, { end: at, failed: block.is_error === true });
      }
    }
  }
  return { first, last, calls: [...calls.values()].sort((a, b) => a.start - b.start) };
}

function stepMeta(short, calls) {
  const meta = calls.length === 1 ? short : `${short} × ${calls.length}`;
  const details = new Set(calls.map((call) => call.detail));
  const [detail] = details;
  return details.size === 1 && detail ? `${meta} · ${detail}` : meta;
}

// horizon is where an unanswered call stops, or null while the run is still open.
const closed = (calls, horizon) => (calls.some((call) => call.end === null && horizon === null) ? null : Math.max(...calls.map((call) => call.end ?? horizon)));
const at = (ms, origin) => (ms === null ? null : seconds(ms, origin));

function toStep(calls, origin, horizon) {
  const [head] = calls;
  const { short, entry } = lookup(head.name);
  return {
    kind: 'step',
    id: head.id,
    name: entry.label,
    meta: stepMeta(short, calls),
    category: entry.category,
    start: seconds(head.start, origin),
    end: at(closed(calls, horizon), origin),
    outcome: head.failed ? 'failed' : 'ok',
    ...(entry.fills && { fieldsFilled: calls.filter((call) => call.end !== null && !call.failed).length }),
    ...(head.failed && { note: TOOL_ERROR_NOTE }),
  };
}

function runs(calls, hasChildren) {
  const out = [];
  for (const call of calls) {
    const previous = out.at(-1);
    const joinable = previous && previous[0].name === call.name && lookup(call.name).entry.category !== 'human' && !previous[0].failed && !call.failed && !hasChildren(previous[0]) && !hasChildren(call);
    if (joinable) previous.push(call);
    else out.push([call]);
  }
  return out;
}

export function buildNodes(calls, origin, horizon) {
  const known = new Set(calls.map((call) => call.id));
  const kids = Map.groupBy(calls.filter((call) => known.has(call.parent)), (call) => call.parent);
  const hasChildren = (call) => kids.has(call.id);
  const level = (siblings) => runs(siblings, hasChildren).map((run) => {
    const [head] = run;
    if (!hasChildren(head)) return toStep(run, origin, horizon);
    return {
      kind: 'group',
      id: head.id,
      name: lookup(head.name).entry.label,
      meta: head.detail ?? '',
      role: 'worker',
      start: seconds(head.start, origin),
      end: at(closed([head, ...kids.get(head.id)], horizon), origin),
      children: level(kids.get(head.id)),
    };
  });
  return level(calls.filter((call) => !known.has(call.parent)));
}
