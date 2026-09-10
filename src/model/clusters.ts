/**
 * Fine-grained majors that share a freshman core, collapsed to one bucket.
 *
 * Top-1 accuracy against 79 programs punishes the model for a distinction a
 * booklist genuinely cannot carry: two engineering disciplines taking the same
 * eight courses are the same booklist. Cluster accuracy measures what the data
 * can actually resolve, and the gap between the two is the honest statement of
 * how far one term gets you.
 */

import { schoolOf } from "../store/majors";

export const CLUSTERS: [RegExp, string][] = [
  [/engineer|computer science|cyber/i, "Engineering / CS"],
  [/nursing|dnp|allied health|exercise|sport medicine|nutrition|pre-?med/i, "Health"],
  [/biology|zoology|molecular|chemistr|biochem|environmental|geology/i, "Bio / Chem"],
  [/finance|marketing|management|econ|business|accounting|entrepreneur|pre-?law/i, "Business"],
  [/biblical|theolog|worship|ministry|mdiv|divinity/i, "Bible / Ministry"],
  [
    /english|communication|writing|linguistic|history|political|international|spanish|liberal arts|advocacy/i,
    "Humanities",
  ],
  [/design|art|music|keyboard|composition|pedagogy/i, "Arts"],
  [/education|mathematic|physics/i, "Education / Math / Physics"],
];

/**
 * The bucket a program belongs to.
 *
 * The registrar's own school is the right answer when we have it: it is the
 * university's judgement rather than mine, and it covers programs no regex of
 * mine anticipated. The patterns above stay as the fallback for a program the
 * taxonomy has never heard of, and for a database that has not imported one.
 */
export function clusterOf(major: string): string {
  if (!major) return "";
  const school = schoolOf(major);
  if (school) return school;
  for (const [pattern, name] of CLUSTERS) if (pattern.test(major)) return name;
  return "Other";
}
