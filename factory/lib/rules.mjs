// These rules read source text, so they stop the drift an honest author writes by accident, not a determined bypass.
// They do not see importlib or getattr lookups, names built at run time or held in lists, os.exec* and os.spawn*,
// a binary named only through a constant, or a Cache bound to a second name by assignment.
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const TOP_SKIP = new Set(['test', 'prompts', 'manifest.json', 'SKILL.md', 'README.md']);
const ANY_SKIP = new Set(['__pycache__', 'node_modules']);
const KIT = 'kit/py/src/factory_kit';

const BIN = String.raw`["']([\w.+-]+)(?=[\s"'])`;
const SPAWNERS = [String.raw`subprocess\.\w+`, String.raw`os\.system`, String.raw`os\.popen`, String.raw`asyncio\.create_subprocess_\w+`, 'spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync'];
const COMMAND_LIST = new RegExp(String.raw`^[ \t]*(\w+)[ \t]*(?::[^=\n]+)?=\s*\[\s*${BIN}`);
const JS_RUNTIME = new RegExp(String.raw`js_runtimes["']?\s*[:=]\s*\{\s*${BIN}`);
const STATEMENT = String.raw`(?:^|;)[ \t]*(?:(?:if|elif|else|try|except|finally|with|for|while)\b[^\n]*?:[ \t]*)?`;
const FROM_IMPORT = new RegExp(String.raw`${STATEMENT}from[ \t]+(\.?[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#;]+)`);
const IMPORT = new RegExp(String.raw`${STATEMENT}import[ \t]+([\w., \t]+)`);
const SHELL_SCRIPT = /^#!(?:\S*\/)?(?:env[ \t]+)?(?:ba|da|z)?sh\b/;
const SHELL_COMMAND = /(?:^|[;&|(`]|\$\()[ \t]*(?:(?:exec|then|do|else|command|time|if|while|until|!)[ \t]+)*([A-Za-z_][\w.+-]*)(?=[ \t;&|)`]|$)/;
const POSIX = new Set(
  'alias cd command echo eval exec exit export false getopts local printf pwd read readonly return set shift test trap true type ulimit umask unset wait basename cat chmod cp cut date dirname env expr find grep head ln ls mkdir mktemp mv readlink rm sed sleep sort tail tee touch tr uname uniq wc xargs'.split(' '),
);

function files(dir, root, top = true) {
  return readdirSync(dir).flatMap((name) => {
    if (ANY_SKIP.has(name) || (top && TOP_SKIP.has(name)) || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, root, false);
    return [{ rel: relative(root, path), text: readFileSync(path, 'utf8') }];
  });
}

function scan(sources, pattern) {
  const global = new RegExp(pattern.source, `${pattern.flags.replace(/[gm]/g, '')}gm`);
  return sources.flatMap(({ rel, text }) =>
    [...text.matchAll(global)].map((match) => ({ at: `${rel}:${text.slice(0, match.index).split('\n').length}`, match })),
  );
}

function uncomment(sources) {
  return sources.map((s) => ({ ...s, text: s.text.replace(/^((?:[^#'"\n]|"[^"\n]*"|'[^'\n]*')*)#.*$/gm, '$1') }));
}

function bindings(list) {
  return list
    .replace(/[()]/g, '')
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, , as]) => ({ name, as: as ?? name }));
}

function imports(sources) {
  return [
    ...scan(sources, FROM_IMPORT).map(({ at, match }) => ({ at, module: match[1], names: bindings(match[2]) })),
    ...scan(sources, IMPORT).flatMap(({ at, match }) => bindings(match[1]).map(({ name, as }) => ({ at, module: name, as, names: [] }))),
  ];
}

function kitClosure(root, found) {
  const seen = new Map();
  const visit = (module) => {
    const rel = `${KIT}/${module}.py`;
    if (seen.has(module) || !existsSync(join(root, rel))) return;
    const file = { rel, text: readFileSync(join(root, rel), 'utf8') };
    seen.set(module, file);
    for (const i of imports([file])) if (i.module.startsWith('.')) (i.module === '.' ? i.names.map((n) => n.name) : [i.module.slice(1)]).forEach(visit);
  };
  for (const i of found) {
    if (i.module === 'factory_kit') i.names.forEach((n) => visit(n.name));
    else if (i.module.startsWith('factory_kit.')) visit(i.module.split('.')[1]);
  }
  return seen;
}

function spawners(found) {
  const subprocess = found.filter((i) => i.module === 'subprocess');
  const local = [...subprocess.filter((i) => !i.names.length).map((i) => String.raw`${i.as}\.\w+`), ...subprocess.flatMap((i) => i.names.map((n) => n.as))];
  return String.raw`(?<!\w)(?:${[...SPAWNERS, ...local].join('|')})\(\s*(?:args\s*=\s*)?`;
}

function shellCommands(sources) {
  const scripts = sources
    .filter(({ rel, text }) => rel.endsWith('.sh') || SHELL_SCRIPT.test(text))
    .map((s) => ({ ...s, text: s.text.replace(/(^|\s)#.*$/gm, '$1') }));
  return scan(scripts, SHELL_COMMAND).filter(({ match }) => !POSIX.has(match[1]));
}

function binariesRun(sources, found = imports(sources)) {
  const runs = spawners(found);
  const lists = scan(sources, COMMAND_LIST).filter(({ match }) => {
    const passed = new RegExp(String.raw`${runs}\[?\s*\*?${match[1]}\b`);
    return sources.some(({ text }) => passed.test(text));
  });
  const literal = [new RegExp(String.raw`shutil\.which\(\s*${BIN}`), new RegExp(`${runs}\\[?\\s*${BIN}`), JS_RUNTIME];
  return [...literal.flatMap((pattern) => scan(sources, pattern)), ...lists, ...shellCommands(sources)].map(({ at, match }) => ({ at, bin: match.at(-1) }));
}

function references(entry, sources, found, entries) {
  return [...entries.values()].flatMap((other) => {
    const folder = other.rel.split('/')[0];
    const module = other.name.replaceAll('-', '_');
    const imported = (i) => {
      const [head, next] = i.module.split('.');
      return head === module || (head === folder && (next ? next === module : i.names.some((n) => n.name === module)));
    };
    const named = entry.type === 'tool' ? `["']${other.name}["']` : String.raw`(?:\w\(\s*|/\s*)["']${other.name}["']|["']${other.name}["']\s*/`;
    return [
      ...found.filter(imported).map(({ at }) => ({ at, other, how: 'imports' })),
      ...scan(sources, new RegExp(`(?:^|[^\\w-])(?:${folder}/|(?:\\.\\./)+)${other.name}/src`)).map(({ at }) => ({ at, other, how: 'imports' })),
      ...scan(sources, new RegExp(`${named}|(?:^|[^\\w-])(?:${folder}/|(?:\\.\\./)+)${other.name}/(?!src)`)).map(({ at }) => ({ at, other, how: 'calls' })),
    ];
  });
}

function facts(entry, root, entries) {
  const sources = files(entry.dir, root);
  const found = imports(sources);
  const kit = kitClosure(root, found);
  const cached = uncomment(sources);
  return {
    sources,
    kitImports: found.filter((i) => i.module === 'factory_kit' || i.module.startsWith('factory_kit.')),
    usesModel: kit.has('model'),
    binaries: binariesRun(sources, found),
    kitBinaries: binariesRun([...kit.values()]),
    caches: scan(cached, new RegExp(`\\b(?:${['Cache', ...imports(cached).flatMap((i) => i.names.filter((n) => n.name === 'Cache').map((n) => n.as))].join('|')})\\(`)),
    references: references(entry, sources, found, entries).filter((r) => r.other !== entry),
  };
}

function describe(entry) {
  return `${entry.name} is ${/^[aeiou]/.test(entry.kind) ? 'an' : 'a'} ${entry.kind} ${entry.type}`;
}

const binName = (spec) => spec.split('>=')[0];

export const RULES = [
  {
    id: 'atoms-import-only-kit',
    check: (atom, f) =>
      atom.type !== 'atom'
        ? []
        : f.references.map(({ at, other, how }) => `${at}: atom ${atom.name} ${how} ${other.type} ${other.name}. Atoms import the kit, never each other.`),
  },
  {
    id: 'tools-call-only-uses',
    check(tool, f, { entries, root }) {
      if (tool.type !== 'tool') return [];
      const uses = tool.manifest.uses ?? [];
      return [
        ...uses
          .filter((name) => entries.get(name)?.type !== 'atom' && !existsSync(join(root, 'atoms', name, 'manifest.json')))
          .map((name) => `${tool.rel}/manifest.json: tool ${tool.name} uses ${name}, which is not an atom.`),
        ...f.references
          .filter(({ other, how }) => how === 'imports' || !uses.includes(other.name))
          .map(({ at, other, how }) =>
            how === 'imports'
              ? `${at}: tool ${tool.name} imports the code of ${other.type} ${other.name}. Tools call atom CLIs.`
              : `${at}: tool ${tool.name} calls ${other.type} ${other.name}, which its uses does not list.`,
          ),
        ...f.kitImports.map(({ at }) => `${at}: tool ${tool.name} imports the kit. Tools call atom CLIs.`),
      ];
    },
  },
  {
    id: 'tool-kind-shape',
    check(tool, f, { root }) {
      if (tool.type !== 'tool') return [];
      const skillMd = existsSync(join(tool.dir, 'SKILL.md')) ? [] : [`${tool.rel}: ${describe(tool)}, but it has no SKILL.md.`];
      if (tool.kind !== 'skill') return skillMd;
      const scripts = f.sources.filter(({ rel }) => executable(join(root, rel)));
      return [...skillMd, ...scripts.map(({ rel }) => `${rel}: ${describe(tool)}, which holds SKILL.md and no script.`)];
    },
  },
  {
    id: 'declare-binaries',
    check(entry, f) {
      const { needs, runtime } = entry.manifest;
      const declared = new Set([...needs.bin.map(binName), runtime]);
      return [
        ...[...f.binaries, ...f.kitBinaries]
          .filter(({ bin }) => !declared.has(bin))
          .map(({ at, bin }) => `${at}: ${entry.name} runs ${bin}, which needs.bin in ${entry.rel}/manifest.json does not declare.`),
        ...f.binaries
          .filter(({ bin }) => needs.paid.includes(bin))
          .map(({ at, bin }) => `${at}: ${entry.name} runs the paid backend ${bin} itself. Model calls go through the kit's model adapter and its budget.`),
      ];
    },
  },
  {
    id: 'kind-decides-caching',
    check(atom, f) {
      if (atom.type !== 'atom') return [];
      if (atom.info.cache === null) return f.caches.map(({ at }) => `${at}: ${describe(atom)}, which is never cached, but it builds a Cache.`);
      return f.caches.length ? [] : [`${atom.rel}: ${describe(atom)}, cached ${atom.info.cache}, but no source builds a Cache.`];
    },
  },
  {
    id: 'kind-decides-cost',
    check(atom, f, { backends }) {
      if (atom.type !== 'atom') return [];
      const { paid, bin } = atom.manifest.needs;
      if (atom.info.cost === 'logged') {
        return [
          ...(f.usesModel ? [] : [`${atom.rel}: ${describe(atom)}, but no source imports the kit's model adapter.`]),
          ...(paid.length ? [] : [`${atom.rel}/manifest.json: ${describe(atom)}, but needs.paid is empty.`]),
        ];
      }
      if (atom.info.cost !== 'free') return [];
      return [
        ...(f.usesModel ? [`${atom.rel}: ${describe(atom)}, which is free, but it imports the kit's model adapter.`] : []),
        ...(paid.length ? [`${atom.rel}/manifest.json: ${describe(atom)}, which is free, but needs.paid lists ${paid.join(', ')}.`] : []),
        ...bin.map(binName).filter((name) => backends.has(name)).map((name) => `${atom.rel}/manifest.json: ${describe(atom)}, which is free, but needs.bin lists the paid backend ${name}.`),
        ...f.binaries.filter(({ bin }) => backends.has(bin)).map(({ at, bin }) => `${at}: ${describe(atom)}, which is free, but it runs the paid backend ${bin}.`),
      ];
    },
  },
  {
    id: 'cli-contract',
    check(entry, f, { root }) {
      const { manifest, rel } = entry;
      const contract = (name) => existsSync(join(root, 'contracts', `${name}.schema.json`));
      const problems = [];
      if (!contract(manifest.contract)) problems.push(`${rel}/manifest.json: contract ${manifest.contract} has no contracts/${manifest.contract}.schema.json.`);
      if (entry.entry && !executable(entry.entry)) problems.push(`${rel}/${manifest.entry}: the entry is missing or not executable.`);
      for (const verb of manifest.verbs ?? []) {
        if (!contract(verb.output)) problems.push(`${rel}/manifest.json: verb ${verb.name} returns ${verb.output}, which has no contracts/${verb.output}.schema.json.`);
        const { properties, required = [] } = verb.input;
        for (const name of required) {
          if (!properties[name]) problems.push(`${rel}/manifest.json: verb ${verb.name} requires ${name}, which its input does not define.`);
        }
        for (const [name, prop] of Object.entries(properties)) {
          if (prop.type === 'array' && !required.includes(name)) problems.push(`${rel}/manifest.json: verb ${verb.name} has an optional array ${name}, which the CLI cannot take.`);
        }
      }
      if (entry.info.tests && !existsSync(join(entry.dir, 'test', 'test.sh'))) problems.push(`${rel}: ${entry.name} has no test/test.sh.`);
      return problems;
    },
  },
];

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function paidBackends(root) {
  const rel = `${KIT}/model.py`;
  if (!existsSync(join(root, rel))) return new Set();
  return new Set(binariesRun([{ rel, text: readFileSync(join(root, rel), 'utf8') }]).map(({ bin }) => bin));
}

export function check({ root, entries, problems }) {
  const context = { root, entries, backends: paidBackends(root) };
  const all = [...entries.values()].map((entry) => [entry, facts(entry, root, entries)]);
  const failures = RULES.flatMap((rule) =>
    [...new Set(all.flatMap(([entry, f]) => rule.check(entry, f, context)))].map((message) => ({ rule: rule.id, message })),
  );
  return [...problems.map(({ path, message }) => ({ rule: 'manifest-matches-schema', message: `${path}: ${message}` })), ...failures];
}
