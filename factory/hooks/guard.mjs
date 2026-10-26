#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { load } from '../lib/registry.mjs';
import { budget, spentToday } from '../lib/runs.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function block(message) {
  console.error(message);
  process.exit(2);
}

const GUARDS = {
  budget(entry) {
    let cap;
    let spent;
    try {
      cap = budget();
      spent = spentToday();
    } catch (e) {
      block(`Blocked ${entry.name}: ${e.message}`);
    }
    if (spent >= cap) {
      block(
        `Blocked ${entry.name}: model spend today is $${spent.toFixed(4)}, at the $${cap.toFixed(2)} daily cap. To raise the cap, export TOOL_FACTORY_BUDGET_USD in the shell that starts Claude Code, or wait for the next UTC day.`,
      );
    }
  },
  confirm: (entry) => `${entry.name} is an act atom, so every run needs your confirmation.`,
};

function guard() {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const command = payload.tool_name === 'Bash' ? payload.tool_input?.command ?? '' : '';
  if (!command) return;
  const calls = (entry) =>
    new RegExp(`(?:^|[\\s;&|(\`/"'])${escape(entry.name)}["']?\\s+(?:${entry.manifest.verbs.map((v) => escape(v.name)).join('|')})\\b`).test(command);
  const reasons = [...load().entries.values()]
    .filter((entry) => entry.info.guard && calls(entry))
    .map((entry) => GUARDS[entry.info.guard](entry))
    .filter(Boolean);
  if (reasons.length) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reasons.join(' ') } }));
  }
}

try {
  guard();
} catch (e) {
  block(`Blocked: the factory guard failed, so it cannot check this call: ${e.message}`);
}
