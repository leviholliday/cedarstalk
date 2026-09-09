/**
 * Scoring the model against known majors.
 *
 * Three numbers, because they answer different questions. Exact is whether the
 * top guess is the program on their transcript. Top-3 is whether the answer is
 * on screen at all. Cluster is whether the booklist resolved as far as a
 * booklist can — a MechE guessed as CompE is not a failure of the model so
 * much as a fact about freshman year.
 *
 * Every run is appended to the metrics table so the climb is visible as terms
 * accumulate. That log is the point: the model is supposed to get sharper.
 */

import { allLabels, fingerprintOf, harvestTerms, recordMetric } from "../store/harvest";
import { clusterOf } from "./clusters";
import { model } from "./major";

export interface Evaluation {
  source: string;
  terms: string;
  scored: number;
  skipped: number;
  exact: number;
  top3: number;
  cluster: number;
  misses: { studentId: string; known: string; guessed: string }[];
}

const same = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z]/g, "") === b.toLowerCase().replace(/[^a-z]/g, "");

export function evaluate({
  source,
  year,
  record = true,
}: {
  source?: string;
  year?: string;
  record?: boolean;
} = {}): Evaluation {
  const engine = model(year);
  const labels = allLabels().filter((l) => !source || l.source === source);
  const terms = harvestTerms()
    .map((t) => t.term)
    .join("+");

  let scored = 0;
  let skipped = 0;
  let exact = 0;
  let top3 = 0;
  let cluster = 0;
  const misses: Evaluation["misses"] = [];

  for (const label of labels) {
    const fingerprint = fingerprintOf(label.studentId);
    if (!fingerprint?.courses.length) {
      skipped++;
      continue;
    }
    scored++;

    const ranked = engine.guess(fingerprint.courses).ranked;
    const top = ranked.slice(0, 3).map((g) => g.title);
    const known = [label.major, label.major2].filter(Boolean) as string[];
    const first = top[0] ?? "";

    const hitExact = known.some((k) => same(k, first));
    const hitTop3 = known.some((k) => top.some((t) => same(k, t)));
    const hitCluster = known.some((k) => clusterOf(k) && clusterOf(k) === clusterOf(first));

    if (hitExact) exact++;
    if (hitTop3) top3++;
    if (hitCluster) cluster++;
    if (!hitTop3)
      misses.push({ studentId: label.studentId, known: known.join(" + "), guessed: first });
  }

  const rate = (n: number) => (scored ? n / scored : 0);
  const evaluation: Evaluation = {
    source: source ?? "all",
    terms,
    scored,
    skipped,
    exact: rate(exact),
    top3: rate(top3),
    cluster: rate(cluster),
    misses,
  };

  if (record && scored) {
    recordMetric({
      at: new Date().toISOString(),
      source: evaluation.source,
      terms,
      scored,
      exact: evaluation.exact,
      top3: evaluation.top3,
      cluster: evaluation.cluster,
    });
  }
  return evaluation;
}
