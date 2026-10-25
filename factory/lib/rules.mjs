import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP = new Set(['test', 'prompts', 'manifest.json', 'SKILL.md', 'README.md', '__pycache__', 'node_modules']);
const KIT = 'kit/py/src/factory_kit';

const RUNS = String.raw`(?:subprocess\.\w+|spawn|spawnSync|execFile|execFileSync)\(\s*`;
const BIN = String.raw`["']([\w.+-]+)["']`;
const LITERAL_RUNS = [new RegExp(String.raw`shutil\.which\(\s*${BIN}`), new RegExp(`${RUNS}\\[?\\s*${BIN}`)];
const COMMAND_LIST = new RegExp(String.raw`^[ \t]*(\w+)\s*=\s*\[\s*${BIN}`);
const IMPORT = /^[ \t]*(?:from[ \t]+([\w.]+)[ \t]+import[ \t]+([\w \t,]+)|import[ \t]+([\w.]+))/;
const BUILDS_CACHE = /\bCache\(/;
const ASKS_MODEL = /\bmodel\.ask\(|from\s+factory_kit\.model\s+import|import\s+factory_kit\.model/;

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

function kitModules(root, sources) {
  const seen = new Map();
  const visit = (module) => {
    const rel = `${KIT}/${module}.py`;
    if (seen.has(rel) || !existsSync(join(root, rel))) return;
    const file = { rel, text: readFileSync(join(root, rel), 'utf8') };
    seen.set(rel, file);
    for (const m of file.text.matchAll(/^[ \t]*from[ \t]+\.(\w*)[ \t]+import[ \t]+([\w \t,]+)/gm)) {
      (m[1] ? [m[1]] : names(m[2])).forEach(visit);
    }
  };
  for (const { match } of scan(sources, IMPORT)) {
    const module = match[1] ?? match[3];
    if (module === 'factory_kit') names(match[2]).forEach(visit);
    else if (module.startsWith('factory_kit.')) visit(module.split('.')[1]);
  }
  return [...seen.values()];
}

function article(word) {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}

function names(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean);
}

function binariesRun(sources) {
  const lists = scan(sources, COMMAND_LIST).filter(({ match }) =>
    sources.some(({ text }) => new RegExp(`${RUNS}${match[1]}\\b`).test(text)),
  );
  return [...LITERAL_RUNS.flatMap((pattern) => scan(sources, pattern)), ...lists].map(({ at, match }) => ({ at, bin: match.at(-1) }));
}

function binName(spec) {
  return spec.split('>=')[0];
}

function importsOf(sources) {
  return scan(sources, IMPORT).map(({ at, match }) => ({ at, root: (match[1] ?? match[3]).split('.')[0].replaceAll('_', '-') }));
}

function pathRefs(sources, folder, name) {
  return scan(sources, new RegExp(`(?:^|[^\\w-])(?:${folder}/|(?:\\.\\./)+)${name}/`));
}

export const RULES = [
  {
    id: 'atoms-import-only-kit',
    check({ entries, sourcesOf }) {
      const others = [...entries.values()];
      return atoms(entries).flatMap((atom) => {
        const own = sourcesOf(atom);
        return others
          .filter((other) => other !== atom)
          .flatMap((other) => [
            ...importsOf(own).filter((i) => i.root === other.name),
            ...pathRefs(own, `${other.rel.split('/')[0]}`, other.name),
          ].map(({ at }) => `${at}: atom ${atom.name} imports ${other.type} ${other.name}. Atoms import the kit, never each other.`));
      });
    },
  },
  {
    id: 'tools-call-only-uses',
    check({ entries, sourcesOf }) {
      return tools(entries).flatMap((tool) => {
        const uses = tool.manifest.uses;
        const own = sourcesOf(tool);
        const unknown = uses
          .filter((name) => entries.get(name)?.type !== 'atom')
          .map((name) => `${tool.rel}/manifest.json: tool ${tool.name} uses ${name}, which is not an atom.`);
        const calls = [...entries.values()]
          .filter((other) => other !== tool && !uses.includes(other.name))
          .flatMap((other) => [
            ...scan(own, new RegExp(`["']${other.name}["']`)),
            ...pathRefs(own, other.rel.split('/')[0], other.name),
          ].map(({ at }) => `${at}: tool ${tool.name} calls ${other.type} ${other.name}, which its uses does not list.`));
        const code = uses.flatMap((name) => [
          ...importsOf(own).filter((i) => i.root === name),
          ...scan(own, new RegExp(`atoms/${name}/src`)),
        ].map(({ at }) => `${at}: tool ${tool.name} imports the code of atom ${name}. Tools call atom CLIs.`));
        return [...unknown, ...calls, ...code];
      });
    },
  },
  {
    id: 'declare-binaries',
    check({ entries, sourcesOf, root }) {
      return [...entries.values()].flatMap((entry) => {
        const own = sourcesOf(entry);
        const declared = new Set(entry.manifest.needs.bin.map(binName));
        const paid = new Set(entry.manifest.needs.paid);
        const undeclared = [...binariesRun(own), ...kitModules(root, own).flatMap((kit) => binariesRun([kit]))]
          .filter(({ bin }) => !declared.has(bin))
          .map(({ at, bin }) => `${at}: ${entry.name} runs ${bin}, which needs.bin in ${entry.rel}/manifest.json does not declare.`);
        const bypass = binariesRun(own)
          .filter(({ bin }) => paid.has(bin))
          .map(({ at, bin }) => `${at}: ${entry.name} runs the paid backend ${bin} itself. Model calls go through the kit's model adapter and its budget.`);
        return [...undeclared, ...bypass];
      });
    },
  },
  {
    id: 'kind-decides-caching',
    check({ entries, sourcesOf }) {
      return atoms(entries).flatMap((atom) => {
        const builds = scan(sourcesOf(atom), BUILDS_CACHE);
        if (atom.info.cache === null) {
          return builds.map(({ at }) => `${at}: ${atom.name} is ${article(atom.kind)} ${atom.kind} atom, which is never cached, but it builds a Cache.`);
        }
        return builds.length ? [] : [`${atom.rel}: ${atom.name} is ${article(atom.kind)} ${atom.kind} atom, cached ${atom.info.cache}, but no source builds a Cache.`];
      });
    },
  },
  {
    id: 'kind-decides-cost',
    check({ entries, sourcesOf }) {
      return atoms(entries).flatMap((atom) => {
        const asks = scan(sourcesOf(atom), ASKS_MODEL);
        const paid = atom.manifest.needs.paid;
        if (atom.info.cost === 'logged') {
          return [
            ...(asks.length ? [] : [`${atom.rel}: ${atom.name} is a model atom, but no source calls the kit's model adapter.`]),
            ...(paid.length ? [] : [`${atom.rel}/manifest.json: ${atom.name} is a model atom, but needs.paid is empty.`]),
          ];
        }
        if (atom.info.cost !== 'free') return [];
        return [
          ...asks.map(({ at }) => `${at}: ${atom.name} is ${article(atom.kind)} ${atom.kind} atom, which is free, but it calls the kit's model adapter.`),
          ...(paid.length ? [`${atom.rel}/manifest.json: ${atom.name} is ${article(atom.kind)} ${atom.kind} atom, which is free, but needs.paid lists ${paid.join(', ')}.`] : []),
        ];
      });
    },
  },
  {
    id: 'cli-contract',
    check({ entries, root }) {
      const contract = (name) => existsSync(join(root, 'contracts', `${name}.schema.json`));
      return [...entries.values()].flatMap((entry) => {
        const { manifest, rel } = entry;
        const problems = [];
        if (!contract(manifest.contract)) problems.push(`${rel}/manifest.json: contract ${manifest.contract} has no contracts/${manifest.contract}.schema.json.`);
        if (entry.entry && !executable(entry.entry)) problems.push(`${rel}/${manifest.entry}: the entry is missing or not executable.`);
        for (const verb of manifest.verbs ?? []) {
          if (!contract(verb.output)) problems.push(`${rel}/manifest.json: verb ${verb.name} returns ${verb.output}, which has no contracts/${verb.output}.schema.json.`);
          const props = Object.keys(verb.input.properties);
          for (const name of verb.input.required ?? []) {
            if (!props.includes(name)) problems.push(`${rel}/manifest.json: verb ${verb.name} requires ${name}, which its input does not define.`);
          }
        }
        if (entry.kind !== 'skill' && !existsSync(join(entry.dir, 'test', 'test.sh'))) problems.push(`${rel}: ${entry.name} has no test/test.sh.`);
        return problems;
      });
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

function atoms(entries) {
  return [...entries.values()].filter((e) => e.type === 'atom');
}

function tools(entries) {
  return [...entries.values()].filter((e) => e.type === 'tool');
}

export function check({ root, entries, problems }) {
  const cache = new Map();
  const sourcesOf = (entry) => cache.get(entry) ?? cache.set(entry, files(entry.dir, root)).get(entry);
  const context = { root, entries, sourcesOf };
  return [
    ...problems.map(({ path, message }) => ({ rule: 'manifest-matches-schema', message: `${path}: ${message}` })),
    ...RULES.flatMap((rule) => rule.check(context).map((message) => ({ rule: rule.id, message }))),
  ];
}
