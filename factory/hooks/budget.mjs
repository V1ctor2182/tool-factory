#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { load } from '../lib/registry.mjs';
import { budget, spentToday } from '../lib/runs.mjs';

const payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = payload.tool_name === 'Bash' ? payload.tool_input?.command ?? '' : '';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const called = [...load().entries.values()].find(
  (entry) =>
    entry.info.guard === 'budget' &&
    new RegExp(`(?:^|[\\s;&|(\`/])${escape(entry.name)}\\s+(?:${entry.manifest.verbs.map((v) => escape(v.name)).join('|')})\\b`).test(command),
);

if (called) {
  let cap;
  try {
    cap = budget();
  } catch (e) {
    console.error(`Blocked ${called.name}: ${e.message}`);
    process.exit(2);
  }
  const spent = spentToday();
  if (spent >= cap) {
    console.error(
      `Blocked ${called.name}: model spend today is $${spent.toFixed(4)}, at the $${cap.toFixed(2)} daily cap. Set TOOL_FACTORY_BUDGET_USD to raise the cap, or wait for the next UTC day.`,
    );
    process.exit(2);
  }
}
