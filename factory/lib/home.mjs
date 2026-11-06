import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function home() {
  const raw = process.env.TOOL_FACTORY_HOME || join(homedir(), '.local', 'share', 'tool-factory');
  return resolve(raw.replace(/^~(?=\/|$)/, homedir()));
}
