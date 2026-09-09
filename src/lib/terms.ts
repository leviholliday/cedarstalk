/**
 * Term codes, the way Colleague writes them.
 *
 * "2027SP" is the spring of the 2026-2027 academic year, which starts in
 * August. Guessing the current one wrong by a semester would send the
 * harvester after a booklist nobody has bought yet, so the boundaries are
 * spelled out rather than inferred from the calendar year alone.
 */

export type Season = "FA" | "SP" | "SU";

export function currentTerm(now = new Date()): string {
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  if (month >= 7) return `${year}FA`; // August onward
  if (month >= 4) return `${year}SU`; // May through July
  return `${year}SP`;
}

/** The term after this one, which is the one the store starts listing first. */
export function nextTerm(term = currentTerm()): string {
  const year = Number(term.slice(0, 4));
  const season = term.slice(4) as Season;
  if (season === "FA") return `${year + 1}SP`;
  if (season === "SP") return `${year}SU`;
  return `${year}FA`;
}

/** August starts the academic year, so "2026-2027" is right from then on. */
export function catalogYear(now = new Date()): string {
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}
