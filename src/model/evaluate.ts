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

const flatten = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * A label and a program title naming the same thing.
 *
 * Labels arrive the way a person says them and the catalog prints them the way
 * the registrar files them, so "Biology" has to meet "Biology — BS". The book
 * splits a major across degree tracks a booklist cannot tell apart, and a
 * roster never records which one; scored strictly, twenty of a hundred labels
 * could not have matched anything on the page. So the degree suffix comes off
 * before comparing, and a label that is a prefix of a title counts, which is
 * how "Language Arts Education" reaches "Language Arts Education Integrated".
 */
const DEGREE = /\s*[—-]\s*(BA|BS|BSN|BME|BMU|BFA|BSBA)\s*$/i;

const same = (a: string, b: string) => {
  if (flatten(a) === flatten(b)) return true;
  const left = flatten(a.replace(DEGREE, ""));
  const right = flatten(b.replace(DEGREE, ""));
  if (left === right) return true;
  // Short stems match too much: "art" would swallow every title starting in it.
  if (left.length < 5 || right.length < 5) return false;
  return left.startsWith(right) || right.startsWith(left);
};

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
