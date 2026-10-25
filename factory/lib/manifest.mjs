import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  integer: Number.isInteger,
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validate(schema, value, root = schema, at = '') {
  const where = at || '/';
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${where} is not allowed`];
  if (schema.$ref) return validate(resolve(root, schema.$ref), value, root, at);
  const errors = [];
  const types = [schema.type ?? []].flat();
  if (types.length && !types.some((t) => TYPES[t](value))) return [`${where} is not ${types.join(' or ')}`];
  if (schema.const !== undefined && !same(schema.const, value)) errors.push(`${where} is not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, value))) errors.push(`${where} is not one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${where} is empty`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${where} "${value}" does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${where} has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${where} has more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${where} has duplicate items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${at}/${i}`)));
  }
  if (TYPES.object(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${where} lacks ${key}`);
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties?.[key] ?? schema.additionalProperties;
      if (sub === false) errors.push(`${at}/${key} is not a known field`);
      else errors.push(...validate(sub, v, root, `${at}/${key}`));
    }
  }
  for (const sub of schema.allOf ?? []) errors.push(...validate(sub, value, root, at));
  if (schema.not && validate(schema.not, value, root, at).length === 0) {
    errors.push(schema.not.required ? `${where} must not have ${schema.not.required.join(', ')}` : `${where} matches a schema it must not`);
  }
  if (schema.if) {
    const branch = validate(schema.if, value, root, at).length === 0 ? schema.then : schema.else;
    errors.push(...validate(branch, value, root, at));
  }
  return errors;
}

function resolve(root, ref) {
  return ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], root);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadSchema(root) {
  return readJson(join(root, 'contracts', 'service.schema.json'));
}
