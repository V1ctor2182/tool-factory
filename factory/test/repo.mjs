import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '..', '..');

export function copyRepo(root) {
  for (const dir of ['atoms', 'tools', 'contracts', 'kit', 'factory']) {
    cpSync(join(REPO, dir), join(root, dir), { recursive: true, filter: (src) => !src.includes('__pycache__') && !src.includes('.venv') });
  }
  return root;
}

export function manifest(root, rel, change) {
  const path = join(root, rel, 'manifest.json');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  change(m);
  writeFileSync(path, JSON.stringify(m, null, 2));
}
