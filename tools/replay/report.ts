// Replay harness: aggregation and the compact table. Nothing here touches message contents.
import type { PointResult, SessionResult } from './replay.js';

export interface ConfigLabel {
  asker: string;
  policy: string;
  pointsMode: string;
  trim: string;
}

export interface Aggregate extends ConfigLabel {
  sessions: number;
  segmentsWithPoints: number;
  points: number;
  unscored: number;
  errors: number;
  /** 1 - sum(after) / sum(before), in estimated tokens. */
  reductionWeighted: number;
  reductionMean: number;
  meanFloorTokens: number;
  meanFirstFloorTokens: number;
  meanLastFloorTokens: number;
  /** Mean over segments with >= 2 points of (last floor - first floor) / (points - 1). */
  floorGrowthPerPoint: number | null;
  /** Mean assistant turns available to the loss window; well below the window size means weak evidence. */
  meanWindowTurns: number;
  hostCharsTrimmed: number;
  hostMessagesTrimmed: number;
  hostLostAndNeeded: number;
  degraded: number;
  lostAndNeeded: number;
  lostAndNeededRate: number;
  reruns: number;
  rerunRate: number;
  kept: number;
  resultsDropped: number;
  callsDropped: number;
  callsStubbed: number;
  byTool: Record<string, { degraded: number; lostAndNeeded: number; reruns: number }>;
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
const sum = (points: readonly PointResult[], pick: (p: PointResult) => number): number =>
  points.reduce((total, p) => total + pick(p), 0);
const rate = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

export function aggregate(label: ConfigLabel, sessions: readonly SessionResult[]): Aggregate {
  const segments = sessions.flatMap((s) => s.segments).filter((seg) => seg.points.length > 0);
  const points = segments.flatMap((seg) => seg.points);
  const growth = segments
    .filter((seg) => seg.points.length >= 2)
    .map((seg) => (seg.points.at(-1)!.tokensAfter - seg.points[0]!.tokensAfter) / (seg.points.length - 1));
  const byTool: Aggregate['byTool'] = {};
  for (const point of points) {
    for (const [tool, v] of Object.entries(point.byTool)) {
      const entry = (byTool[tool] ??= { degraded: 0, lostAndNeeded: 0, reruns: 0 });
      entry.degraded += v.degraded;
      entry.lostAndNeeded += v.lostAndNeeded;
      entry.reruns += v.reruns;
    }
  }
  const degraded = sum(points, (p) => p.degraded);
  const lostAndNeeded = sum(points, (p) => p.lostAndNeeded);
  const reruns = sum(points, (p) => p.reruns);
  return {
    ...label,
    sessions: sessions.filter((s) => s.segments.some((seg) => seg.points.length > 0)).length,
    segmentsWithPoints: segments.length,
    points: points.length,
    unscored: sessions.reduce((t, s) => t + s.unscored, 0),
    errors: sessions.reduce((t, s) => t + s.errors, 0),
    reductionWeighted: 1 - rate(sum(points, (p) => p.tokensAfter), sum(points, (p) => p.tokensBefore)),
    reductionMean: mean(points.map((p) => p.reduction)),
    meanFloorTokens: mean(points.map((p) => p.tokensAfter)),
    meanFirstFloorTokens: mean(segments.map((seg) => seg.points[0]!.tokensAfter)),
    meanLastFloorTokens: mean(segments.map((seg) => seg.points.at(-1)!.tokensAfter)),
    floorGrowthPerPoint: growth.length === 0 ? null : mean(growth),
    meanWindowTurns: mean(points.map((p) => p.windowTurns)),
    hostCharsTrimmed: sum(points, (p) => p.hostCharsTrimmed),
    hostMessagesTrimmed: sum(points, (p) => p.hostMessagesTrimmed),
    hostLostAndNeeded: sum(points, (p) => p.hostLostAndNeeded),
    degraded,
    lostAndNeeded,
    lostAndNeededRate: rate(lostAndNeeded, degraded),
    reruns,
    rerunRate: rate(reruns, degraded),
    kept: sum(points, (p) => p.kept),
    resultsDropped: sum(points, (p) => p.resultsDropped),
    callsDropped: sum(points, (p) => p.callsDropped),
    callsStubbed: sum(points, (p) => p.callsStubbed),
    byTool,
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const k = (value: number): string => `${(value / 1000).toFixed(1)}k`;

export function formatTable(rows: readonly Aggregate[]): string {
  const header = ['asker', 'policy', 'points', 'trim', 'sess', 'pts', 'reduct', 'floor', 'first', 'last', 'growth/pt', 'degraded', 'lost&needed', 'rerun', 'host cut', 'host needed', 'win', 'skip/err'];
  const body = rows.map((r) => [
    r.asker,
    r.policy,
    r.pointsMode,
    r.trim,
    String(r.sessions),
    String(r.points),
    pct(r.reductionWeighted),
    k(r.meanFloorTokens),
    k(r.meanFirstFloorTokens),
    k(r.meanLastFloorTokens),
    r.floorGrowthPerPoint === null ? 'n/a' : k(r.floorGrowthPerPoint),
    String(r.degraded),
    `${r.lostAndNeeded} (${pct(r.lostAndNeededRate)})`,
    `${r.reruns} (${pct(r.rerunRate)})`,
    `${k(r.hostCharsTrimmed)}ch/${r.hostMessagesTrimmed}msg`,
    String(r.hostLostAndNeeded),
    r.meanWindowTurns.toFixed(1),
    `${r.unscored}/${r.errors}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}
