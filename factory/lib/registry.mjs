import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, readJson, validate } from './manifest.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const KINDS = {
  pipeline: { type: 'tool', cache: null, cost: 'its atoms', guard: null },
  skill: { type: 'tool', cache: null, cost: 'free', guard: null },
  transform: { type: 'atom', cache: 'by content', cost: 'free', guard: null },
  model: { type: 'atom', cache: 'by input, model, and prompt', cost: 'logged', guard: 'budget' },
  observe: { type: 'atom', cache: null, cost: 'free', guard: null },
  act: { type: 'atom', cache: null, cost: 'varies', guard: 'confirm' },
};

const FOLDERS = { tool: 'tools', atom: 'atoms' };

export function load(root = REPO) {
  const schema = loadSchema(root);
  const entries = new Map();
  const problems = [];
  for (const [type, folder] of Object.entries(FOLDERS)) {
    const base = join(root, folder);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const rel = `${folder}/${name}`;
      if (!existsSync(join(base, name, 'manifest.json'))) continue;
      let manifest;
      try {
        manifest = readJson(join(base, name, 'manifest.json'));
      } catch (e) {
        problems.push({ path: `${rel}/manifest.json`, message: e.message });
        continue;
      }
      const errors = validate(schema, manifest);
      if (manifest.name !== name) errors.push(`/name is ${manifest.name}, not the folder name ${name}`);
      if (entries.has(name)) errors.push(`/name ${name} is taken by ${entries.get(name).rel}`);
      const verbs = (manifest.verbs ?? []).map((v) => v.name);
      for (const name of new Set(verbs.filter((v, i) => verbs.indexOf(v) !== i))) errors.push(`/verbs has two verbs named ${name}`);
      if (manifest.type !== type) errors.push(`/type is ${manifest.type}, but the manifest is under ${folder}/`);
      else if (KINDS[manifest.kind] && KINDS[manifest.kind].type !== type) errors.push(`/kind ${manifest.kind} is not a kind of ${type}`);
      if (errors.length) {
        problems.push(...errors.map((message) => ({ path: `${rel}/manifest.json`, message })));
        continue;
      }
      const dir = join(base, name);
      entries.set(name, {
        name,
        type,
        kind: manifest.kind,
        info: KINDS[manifest.kind],
        dir,
        rel,
        manifest,
        entry: manifest.entry ? join(dir, manifest.entry) : null,
      });
    }
  }
  return { root, entries, problems };
}

export function flag(name) {
  return `--${name.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase()}`;
}

export function argv(entry, verb, input) {
  const { properties, required = [] } = verb.input;
  const words = entry.type === 'tool' && entry.manifest.verbs.length === 1 ? [] : [verb.name];
  const positional = required.filter((name) => !properties[name]['x-flag'] && name in input);
  const flags = [];
  for (const [name, value] of Object.entries(input)) {
    if (positional.includes(name)) continue;
    if (properties[name].type === 'boolean') {
      if (value) flags.push(flag(name));
    } else {
      flags.push(flag(name), String(value));
    }
  }
  return [...words, ...positional.flatMap((name) => [input[name]].flat().map(String)), ...flags, '--json'];
}
