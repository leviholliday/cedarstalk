/**
 * What the directory's codes mean.
 *
 * Carried over from cedarstalk, which worked them out first. Only the codes
 * whose meaning is actually known are listed: a wrong expansion of "MG" would
 * be worse than showing "MG", because a reader can look up a code and cannot
 * un-read a confident guess.
 */

export const CLASS_LABELS: Record<string, string> = {
  FR: "Freshman",
  SO: "Sophomore",
  JR: "Junior",
  SR: "Senior",
  GR: "Graduate",
  GS: "Graduate Student",
  HS: "High School",
  P1: "Pharmacy Year 1",
  P2: "Pharmacy Year 2",
  P3: "Pharmacy Year 3",
  P4: "Pharmacy Year 4",
};

export const TYPE_LABELS: Record<string, string> = {
  UG: "Undergraduate",
  UGO: "Undergraduate Online",
  GR: "Graduate",
  GS: "Graduate Student",
  DE: "Dual Enrollment",
  P1: "Pharmacy Year 1",
  P2: "Pharmacy Year 2",
  P3: "Pharmacy Year 3",
  P4: "Pharmacy Year 4",
};

/** The code itself when nothing better is known — never a guess. */
export const classLabel = (code: string | null): string =>
  code ? (CLASS_LABELS[code] ?? code) : "unknown";

export const typeLabel = (code: string | null): string =>
  code ? (TYPE_LABELS[code] ?? code) : "unknown";
