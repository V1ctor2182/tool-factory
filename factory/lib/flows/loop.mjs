import LOOPS from '../loops.json' with { type: 'json' };
import { stage } from './workspace.mjs';

export const LOOP_KEY = 'loop';

const sameEdge = (a) => (b) => a.from === b.from && a.to === b.to;
export const newestFirst = (a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '');

// An adapter measures. loops.json says what the loop is. A stage or an edge it does not declare is an error, so a new
// phase reaches the page only through its declaration.
export function declaredLoop(source, { subtitle, startedAt, state, stages, edges = [] }) {
  const spec = LOOPS[source];
  const undeclaredStage = Object.keys(stages).find((id) => !spec.stages.some((s) => s.id === id));
  if (undeclaredStage) throw new Error(`loops.json does not declare stage ${undeclaredStage} for ${source}`);
  const undeclaredEdge = edges.find((edge) => edge.count && !spec.edges.some(sameEdge(edge)));
  if (undeclaredEdge) throw new Error(`loops.json does not declare edge ${undeclaredEdge.from} to ${undeclaredEdge.to} for ${source}`);
  return {
    key: LOOP_KEY,
    title: spec.title,
    subtitle,
    startedAt,
    ...(state && { state }),
    stages: spec.stages.map(({ id, title }) => {
      const { agents: found = [], loops = 0, state: measured } = stages[id] ?? {};
      const agents = found.toSorted(newestFirst);
      return { id, title, state: measured ?? stage(id, title, agents).state, loops, agents };
    }),
    backEdges: spec.edges.flatMap((edge) => {
      const count = edges.find(sameEdge(edge))?.count;
      return count ? [{ ...edge, count }] : [];
    }),
  };
}
