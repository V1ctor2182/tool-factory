#!/usr/bin/env node
// Deploys the public flows page. It uploads only the files the Dockerfile copies, because `railway up` from the repo
// root would send the whole working tree. Run `railway link` in the repo root once to choose the project.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE = 'flows';
const WAIT_MS = 5 * 60_000;
const POLL_MS = 5_000;

const root = fileURLToPath(new URL('../..', import.meta.url));
const railway = (...args) => execFileSync('railway', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function imageFiles() {
  const copies = readFileSync(join(root, 'Dockerfile'), 'utf8').split('\n').filter((line) => line.startsWith('COPY '));
  return ['Dockerfile', '.dockerignore', ...copies.flatMap((line) => line.split(/\s+/).slice(1, -1))];
}

function upload() {
  const dir = mkdtempSync(join(tmpdir(), 'factory-deploy-'));
  try {
    for (const file of imageFiles()) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      cpSync(join(root, file), join(dir, file));
    }
    execFileSync('railway', ['up', dir, '--path-as-root', '--service', SERVICE, '--ci'], { cwd: root, stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function waitForSuccess() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const { status } = JSON.parse(railway('deployment', 'list', '--service', SERVICE, '--json'))[0];
    if (status === 'SUCCESS') return;
    if (['FAILED', 'CRASHED', 'REMOVED'].includes(status)) throw new Error(`the deployment ended as ${status}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`the deployment did not finish in ${WAIT_MS / 60_000} minutes`);
}

function publicUrl() {
  const { environments } = JSON.parse(railway('status', '--json'));
  const instances = environments.edges.flatMap(({ node }) => node.serviceInstances.edges.map((edge) => edge.node));
  return `https://${instances.find((instance) => instance.serviceName === SERVICE).domains.serviceDomains[0].domain}`;
}

try {
  upload();
  await waitForSuccess();
  const url = publicUrl();
  const { status } = await fetch(`${url}/healthz`);
  if (status !== 200) throw new Error(`${url}/healthz answered ${status}`);
  console.log(`deployed ${url}/flows`);
} catch (e) {
  console.error(`deploy-flows: ${e.message}`);
  process.exitCode = 1;
}
