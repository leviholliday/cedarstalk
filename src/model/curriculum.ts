/**
 * The shape of the curriculum, as students actually walk it.
 *
 * Two courses are close in this graph when the same students take both --
 * not because a catalog says one requires the other, but because that's what
 * actually happened. Gen-eds end up as the hub everything hangs off; a major
 * shows up as its own dense cluster, connected to the core by whichever
 * courses its students share with everyone else.
 */

import { db } from "../db";

export interface CurriculumNode {
  code: string;
  /** Distinct students whose booklist named this course, this term. */
  students: number;
}

export interface CurriculumEdge {
  a: string;
  b: string;
  /** Students who took both. */
  shared: number;
}

export interface CurriculumGraph {
  term: string;
  minShared: number;
  nodes: CurriculumNode[];
  edges: CurriculumEdge[];
}

/**
 * Course pairs sharing at least `minShared` students, as a graph -- isolated
 * courses (no edge clears the threshold) are left out, since a floating node
 * with no connections has nothing to say in a force-directed layout.
 */
export function courseGraph(term: string, minShared = 3): CurriculumGraph {
  const rows = db()
    .query<{ codes: string }, [string]>("SELECT codes FROM booklists WHERE term = ?")
    .all(term);

  const studentsOf = new Map<string, number>();
  const pairs = new Map<string, number>();

  for (const row of rows) {
    // codesFromBooks already dedupes and sorts per student.
    const codes = JSON.parse(row.codes) as string[];
    for (const code of codes) studentsOf.set(code, (studentsOf.get(code) ?? 0) + 1);
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const key = `${codes[i]}|${codes[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: CurriculumEdge[] = [];
  const connected = new Set<string>();
  for (const [key, shared] of pairs) {
    if (shared < minShared) continue;
    const [a, b] = key.split("|") as [string, string];
    edges.push({ a, b, shared });
    connected.add(a);
    connected.add(b);
  }

  const nodes: CurriculumNode[] = [...connected].map((code) => ({
    code,
    students: studentsOf.get(code) ?? 0,
  }));

  return {
    term,
    minShared,
    nodes: nodes.sort((a, b) => b.students - a.students),
    edges: edges.sort((a, b) => b.shared - a.shared),
  };
}
