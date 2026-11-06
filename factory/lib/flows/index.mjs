import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import * as gameStudio from './game-studio.mjs';
import * as jobApplier from './job-applier.mjs';
import * as siteClone from './site-clone.mjs';
import { rollup } from './transcript.mjs';
import * as tools from './tools.mjs';
import * as uiClone from './ui-clone.mjs';

export const SOURCES = [
  { source: 'game-studio', label: 'Game Studio', runsTitle: 'Features', adapter: gameStudio },
  { source: 'job-applier', label: 'Job Applier', adapter: jobApplier },
  { source: 'ui-clone', label: 'UI Clone', runsTitle: 'Components', adapter: uiClone },
  { source: 'site-clone', label: 'Site Clone', runsTitle: 'Sites', adapter: siteClone },
  { source: 'tools', label: 'Factory tools', adapter: tools },
];

function externalWhere(root, source) {
  const list = JSON.parse(readFileSync(join(root, 'external.json'), 'utf8'));
  const raw = list.find((entry) => entry?.flows === source)?.where;
  if (typeof raw !== 'string') throw new Error(`external.json has no entry with "flows": "${source}"`);
  if (/^https?:\/\//.test(raw)) return raw.replace(/\/+$/, '');
  return resolve(raw.replace(/^~(?=\/|$)/, homedir()));
}

const whereOf = (root, entry) => (entry.adapter.where ? entry.adapter.where() : externalWhere(root, entry.source));

function finish(source, { key, state, stages, ...rest }) {
  const agents = stages.flatMap((stage) => stage.agents);
  const costs = agents.map((agent) => agent.costUsd).filter((cost) => cost !== null);
  const overall = state ?? rollup(stages.map((stage) => stage.state));
  const ends = agents.map((agent) => agent.endedAt).filter(Boolean).sort();
  return {
    ...rest,
    id: `${source}:${key}`,
    source,
    state: overall,
    endedAt: overall === 'done' || overall === 'failed' ? (ends.at(-1) ?? null) : null,
    lastAt: ends.at(-1) ?? null,
    agents: agents.length,
    working: agents.filter((agent) => agent.state === 'running').length,
    loops: stages.reduce((sum, stage) => sum + stage.loops, 0),
    costUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    stages,
  };
}

function summary({ stages, backEdges, ...fields }) {
  return fields;
}

export async function listSource(root, entry) {
  const base = { source: entry.source, label: entry.label, ...(entry.runsTitle && { runsTitle: entry.runsTitle }) };
  let where = null;
  try {
    where = whereOf(root, entry);
    const flows = (await entry.adapter.list(where)).map((flow) => summary(finish(entry.source, flow)));
    flows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const loop = await entry.adapter.loop?.(where);
    return { ...base, where, flows, ...(loop && { loop: finish(entry.source, loop) }), error: null };
  } catch (e) {
    return { ...base, where, flows: [], error: e.message };
  }
}

export async function listFlows(root) {
  return { sources: await Promise.all(SOURCES.map((entry) => listSource(root, entry))) };
}

function locate(root, flowId) {
  const split = flowId.indexOf(':');
  if (split < 0) return null;
  const entry = SOURCES.find((s) => s.source === flowId.slice(0, split));
  return entry ? { entry, key: flowId.slice(split + 1), where: whereOf(root, entry) } : null;
}

export async function getFlow(root, flowId) {
  const found = locate(root, flowId);
  const flow = found && await found.entry.adapter.flow(found.where, found.key);
  return flow ? finish(found.entry.source, flow) : null;
}

export async function getTrace(root, flowId, agentId) {
  const found = locate(root, flowId);
  return found ? found.entry.adapter.trace(found.where, found.key, agentId) : null;
}
