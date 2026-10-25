import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RUNTIMES } from './registry.mjs';

const SKIP = new Set(['test', 'prompts', 'manifest.json', 'SKILL.md', 'README.md', '__pycache__', 'node_modules']);
const KIT = 'kit/py/src/factory_kit';

const RUNS = String.raw`(?:subprocess\.\w+|os\.system|os\.popen|asyncio\.create_subprocess_\w+|spawn|spawnSync|execFile|execFileSync|execSync)\(\s*`;
const BIN = String.raw`["']([\w.+-]+)(?=[\s"'])`;
const LITERAL_RUNS = [new RegExp(String.raw`shutil\.which\(\s*${BIN}`), new RegExp(String.raw`${RUNS}\[?\s*${BIN}`)];
const COMMAND_LIST = new RegExp(String.raw`^[ \t]*(\w+)[ \t]*(?::[^=\n]+)?=\s*\[\s*${BIN}`);
const FROM_IMPORT = /^[ \t]*from[ \t]+(\.?[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/;
const IMPORT = /^[ \t]*import[ \t]+([\w., \t]+)/;
const BUILDS_CACHE = /\bCache\(/;

function files(dir, root) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name) || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, root);
    return [{ rel: relative(root, path), text: readFileSync(path, 'utf8') }];
  });
}

function scan(sources, pattern) {
  const global = new RegExp(pattern.source, `${pattern.flags.replace(/[gm]/g, '')}gm`);
  return sources.flatMap(({ rel, text }) =>
    [...text.matchAll(global)].map((match) => ({ at: `${rel}:${text.slice(0, match.index).split('\n').length}`, match })),
  );
}

function names(list) {
  return list.replace(/[()]/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
}

function imports(sources) {
  return [
    ...scan(sources, FROM_IMPORT).map(({ at, match }) => ({ at, module: match[1], names: names(match[2]) })),
    ...scan(sources, IMPORT).flatMap(({ at, match }) => names(match[1]).map((module) => ({ at, module, names: [] }))),
  ];
}

function kitClosure(root, found) {
  const seen = new Map();
  const visit = (module) => {
    const rel = `${KIT}/${module}.py`;
    if (seen.has(module) || !existsSync(join(root, rel))) return;
    const file = { rel, text: readFileSync(join(root, rel), 'utf8') };
    seen.set(module, file);
    for (const i of imports([file])) if (i.module.startsWith('.')) (i.module === '.' ? i.names : [i.module.slice(1)]).forEach(visit);
  };
  for (const i of found) {
    if (i.module === 'factory_kit') i.names.forEach(visit);
    else if (i.module.startsWith('factory_kit.')) visit(i.module.split('.')[1]);
  }
  return seen;
}

function binariesRun(sources) {
  const lists = scan(sources, COMMAND_LIST).filter(({ match }) =>
    sources.some(({ text }) => new RegExp(`${RUNS}${match[1]}\\b`).test(text)),
  );
  return [...LITERAL_RUNS.flatMap((pattern) => scan(sources, pattern)), ...lists].map(({ at, match }) => ({ at, bin: match.at(-1) }));
}

function references(sources, found, entries) {
  return [...entries.values()].flatMap((other) => {
    const folder = other.rel.split('/')[0];
    const module = other.name.replaceAll('-', '_');
    return [
      ...found.filter((i) => i.module.split('.')[0] === module).map(({ at }) => ({ at, other, how: 'imports' })),
      ...scan(sources, new RegExp(`(?:^|[^\\w-])(?:${folder}/|(?:\\.\\./)+)${other.name}/src`)).map(({ at }) => ({ at, other, how: 'imports' })),
      ...scan(sources, new RegExp(`["']${other.name}["']|(?:^|[^\\w-])${folder}/${other.name}/`)).map(({ at }) => ({ at, other, how: 'calls' })),
    ];
  });
}

function facts(entry, root, entries) {
  const sources = files(entry.dir, root);
  const found = imports(sources);
  const kit = kitClosure(root, found);
  return {
    kitImports: found.filter((i) => i.module === 'factory_kit' || i.module.startsWith('factory_kit.')),
    usesModel: kit.has('model'),
    binaries: binariesRun(sources),
    kitBinaries: binariesRun([...kit.values()]),
    caches: scan(sources, BUILDS_CACHE),
    references: references(sources, found, entries).filter((r) => r.other !== entry),
  };
}

function article(word) {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}

function a(entry) {
  return `${entry.name} is ${article(entry.kind)} ${entry.kind} atom`;
}

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
    check(tool, f, entries) {
      if (tool.type !== 'tool') return [];
      const uses = tool.manifest.uses;
      return [
        ...uses
          .filter((name) => entries.get(name)?.type !== 'atom')
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
    id: 'declare-binaries',
    check(entry, f) {
      const { needs, runtime } = entry.manifest;
      const declared = new Set([...needs.bin.map((spec) => spec.split('>=')[0]), RUNTIMES[runtime]]);
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
      if (atom.info.cache === null) return f.caches.map(({ at }) => `${at}: ${a(atom)}, which is never cached, but it builds a Cache.`);
      return f.caches.length ? [] : [`${atom.rel}: ${a(atom)}, cached ${atom.info.cache}, but no source builds a Cache.`];
    },
  },
  {
    id: 'kind-decides-cost',
    check(atom, f) {
      if (atom.type !== 'atom') return [];
      const paid = atom.manifest.needs.paid;
      if (atom.info.cost === 'logged') {
        return [
          ...(f.usesModel ? [] : [`${atom.rel}: ${a(atom)}, but no source imports the kit's model adapter.`]),
          ...(paid.length ? [] : [`${atom.rel}/manifest.json: ${a(atom)}, but needs.paid is empty.`]),
        ];
      }
      if (atom.info.cost !== 'free') return [];
      return [
        ...(f.usesModel ? [`${atom.rel}: ${a(atom)}, which is free, but it imports the kit's model adapter.`] : []),
        ...(paid.length ? [`${atom.rel}/manifest.json: ${a(atom)}, which is free, but needs.paid lists ${paid.join(', ')}.`] : []),
      ];
    },
  },
  {
    id: 'cli-contract',
    check(entry, f, entries, root) {
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
      if (entry.kind !== 'skill' && !existsSync(join(entry.dir, 'test', 'test.sh'))) problems.push(`${rel}: ${entry.name} has no test/test.sh.`);
      return problems;
    },
  },
];

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function check({ root, entries, problems }) {
  const all = [...entries.values()].map((entry) => [entry, facts(entry, root, entries)]);
  const failures = RULES.flatMap((rule) =>
    [...new Set(all.flatMap(([entry, f]) => rule.check(entry, f, entries, root)))].map((message) => ({ rule: rule.id, message })),
  );
  return [...problems.map(({ path, message }) => ({ rule: 'manifest-matches-schema', message: `${path}: ${message}` })), ...failures];
}
