/**
 * lib/rag/queryExpander.ts — multi-angle query expansion for improved recall.
 *
 * Problem
 * ───────
 * A single query embedding often misses relevant policy chunks because:
 *   - Users phrase questions in everyday language; policies use formal terms
 *   - A vague or broad question produces a "middle ground" vector that scores
 *     below threshold even when the answer is clearly in the data
 *   - A single embedding cannot simultaneously capture all sub-intents of
 *     a multi-part question
 *
 * Solution
 * ────────
 * Generate 2–3 semantically distinct query variants from the original.
 * Each variant is embedded independently and used for a separate retrieval pass.
 * Results are merged and deduplicated — the union gives dramatically better recall
 * than any single embedding alone.
 *
 * Variant types produced:
 *   1. Original query          — exact user intent, unchanged
 *   2. Formal policy rewrite   — maps casual language to HR policy terminology
 *   3. Concept-broadened query — elevates to the policy concept level
 *
 * No LLM calls. No external dependencies. Pure string manipulation (~0 ms).
 */

// ── HR domain synonym map ──────────────────────────────────────────────────────
//
// Keys: common user terms (lowercase)
// Values: formal policy/HR terms that appear in the documents
//
// This is the primary semantic bridge between user language and policy language.

const SYNONYM_MAP: Record<string, string[]> = {
  // Termination / leaving
  "fired":         ["termination", "dismissal", "discharge", "separation from employment"],
  "let go":        ["termination", "dismissal", "separation"],
  "laid off":      ["termination", "layoff", "reduction in force", "separation"],
  "quit":          ["resignation", "voluntary separation", "resignation of employment"],
  "resign":        ["resignation", "voluntary separation"],
  "resignation":   ["voluntary separation", "separation", "leaving employment"],
  "leave":         ["resignation", "separation", "departure"],

  // Benefits and pay
  "pay":           ["compensation", "salary", "wages", "remuneration"],
  "paycheck":      ["compensation", "salary", "wages"],
  "raise":         ["merit increase", "salary adjustment", "compensation increase"],
  "bonus":         ["merit pay", "performance bonus", "incentive compensation"],
  "severance":     ["separation pay", "terminal pay", "final compensation"],

  // Time off / leave
  "time off":      ["leave", "absence", "vacation", "paid leave"],
  "days off":      ["vacation leave", "leave entitlement", "paid leave"],
  "vacation":      ["vacation leave", "annual leave", "paid leave"],
  "holiday":       ["vacation leave", "paid holiday", "leave"],
  "pto":           ["paid time off", "vacation leave", "personal leave"],
  "sick day":      ["sick leave", "medical leave", "illness-related absence"],
  "sick":          ["sick leave", "illness", "medical leave"],
  "unpaid leave":  ["leave without pay", "LWOP", "unpaid absence"],
  "fmla":          ["Family and Medical Leave", "FMLA", "medical leave"],

  // Parental / pregnancy
  "pregnant":      ["pregnancy", "PWFA", "Pregnant Workers Fairness Act", "parental leave", "maternity"],
  "maternity":     ["parental leave", "Paid Parental Leave Policy", "pregnancy"],
  "paternity":     ["parental leave", "Paid Parental Leave Policy", "birth of child"],
  "baby":          ["parental leave", "birth of child", "new child", "paid parental leave"],
  "adoption":      ["parental leave", "adoptive parent", "paid parental leave"],
  "nursing":       ["PUMP Act", "lactation", "breastfeeding", "expressing milk"],
  "breastfeeding": ["PUMP Act", "lactation", "nursing mothers"],

  // Harassment / misconduct
  "harassment":    ["anti-harassment", "hostile work environment", "prohibited conduct"],
  "bully":         ["harassment", "hostile work environment", "workplace violence"],
  "bullying":      ["harassment", "hostile work environment", "prohibited conduct"],
  "discriminate":  ["discrimination", "anti-discrimination", "protected class", "equal opportunity"],
  "racism":        ["racial discrimination", "anti-discrimination", "protected class"],
  "sexism":        ["sex discrimination", "gender discrimination", "anti-harassment"],
  "hostile":       ["hostile work environment", "harassment", "prohibited conduct"],
  "retaliation":   ["retaliation", "non-retaliation", "whistleblower protection"],
  "report":        ["reporting procedure", "complaint process", "ethics hotline", "HR report"],
  "complaint":     ["grievance", "report", "complaint procedure", "HR complaint"],

  // Workplace violence / safety
  "violence":      ["workplace violence", "threatening conduct", "physical assault"],
  "threat":        ["threatening behavior", "workplace violence", "prohibited conduct"],
  "domestic":      ["domestic violence", "workplace domestic violence policy"],
  "stalking":      ["stalking", "domestic violence", "safe leave", "paid safe leave"],
  "assault":       ["physical assault", "workplace violence", "sexual assault"],

  // Drugs / alcohol
  "drugs":         ["drug testing", "substance abuse", "controlled substances", "drug and alcohol policy"],
  "alcohol":       ["alcohol testing", "substance abuse", "drug and alcohol policy"],
  "drinking":      ["alcohol", "substance abuse", "drug and alcohol policy"],
  "marijuana":     ["marijuana", "THC", "cannabis", "drug testing"],
  "weed":          ["marijuana", "THC", "cannabis", "drug testing"],
  "drug test":     ["drug and alcohol testing", "urinalysis", "substance testing"],
  "testing":       ["drug and alcohol testing", "testing policy", "urinalysis"],

  // Performance / discipline
  "performance":   ["performance review", "appraisal", "performance management"],
  "review":        ["performance review", "annual appraisal", "evaluation"],
  "pip":           ["performance improvement plan", "PIP", "corrective action"],
  "discipline":    ["disciplinary action", "corrective action", "progressive discipline"],
  "write up":      ["written warning", "disciplinary action", "corrective action"],
  "warning":       ["written warning", "disciplinary action", "corrective action"],

  // Working arrangements
  "remote":        ["remote work", "telework", "work from home", "hybrid"],
  "work from home":["remote work", "telework", "hybrid work"],
  "wfh":           ["remote work", "telework", "work from home"],

  // Ethics / conduct
  "ethics":        ["code of conduct", "ethics policy", "conflicts of interest"],
  "conflict":      ["conflict of interest", "ethics", "outside employment"],
  "bribe":         ["bribery", "gift policy", "conflicts of interest", "ethics violation"],
  "gift":          ["gift policy", "conflicts of interest", "ethics"],
  "fraud":         ["fraud", "misconduct", "ethics violation", "misuse of funds"],
  "whistleblower": ["ethics hotline", "reporting", "non-retaliation", "good faith report"],

  // People / roles
  "manager":       ["supervisor", "appointing authority", "department head"],
  "supervisor":    ["manager", "appointing authority", "direct supervisor"],
  "employee":      ["employee", "officer", "staff member", "city employee"],
  "contractor":    ["contractor", "independent contractor", "non-employee"],
  "hr":            ["Human Resources", "Department of Human Resources", "DHR"],
  "probation":     ["probationary period", "introductory period", "new employee"],

  // Process / approval
  "approve":       ["approval", "authorized", "approval process", "request approval"],
  "approval":      ["approval process", "authorize", "approval procedure"],
  "apply":         ["application", "request", "apply for", "submit"],
  "appeal":        ["appeal process", "grievance", "challenge decision"],
  "eligibility":   ["eligible", "eligibility requirements", "qualifying conditions"],
  "eligible":      ["eligibility", "qualify", "qualifying conditions"],
  "entitled":      ["entitlement", "eligible", "eligibility"],
  "rights":        ["employee rights", "entitlements", "protected rights"],
};

// ── Topic/concept elevators ───────────────────────────────────────────────────
//
// Maps a specific user term to the broader policy topic it belongs to.
// Used to generate the "concept-broadened" query variant.

const CONCEPT_MAP: Record<string, string> = {
  "fired":            "employment termination and separation",
  "quit":             "voluntary resignation and employment separation",
  "resignation":      "voluntary separation from employment",
  "vacation":         "leave entitlement and paid time off",
  "sick":             "sick leave and medical absence",
  "pregnant":         "parental and pregnancy-related leave benefits",
  "harassment":       "workplace harassment reporting and prohibited conduct",
  "discrimination":   "anti-discrimination policy and protected classes",
  "drugs":            "drug and alcohol testing policy",
  "alcohol":          "drug and alcohol testing policy",
  "remote":           "remote and hybrid work arrangements",
  "performance":      "performance management and evaluation",
  "discipline":       "disciplinary procedures and corrective action",
  "ethics":           "code of conduct and ethics compliance",
  "violence":         "workplace violence prevention and reporting",
  "domestic":         "workplace domestic violence support policy",
  "nursing":          "lactation accommodation and PUMP Act rights",
  "appeal":           "grievance and appeal procedures",
  "probation":        "probationary period requirements",
};

// ── Query generation ──────────────────────────────────────────────────────────

/**
 * Builds a formal-language rewrite of the query by substituting user terms
 * with their policy-language equivalents.
 *
 * E.g. "What happens if I get fired?" →
 *      "What happens in the case of termination or dismissal?"
 */
function buildFormalVariant(query: string): string | null {
  const lower = query.toLowerCase();
  const substitutions: string[] = [];

  for (const [term, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (lower.includes(term)) {
      substitutions.push(synonyms.slice(0, 2).join(" or "));
    }
  }

  if (substitutions.length === 0) return null;

  // Build an expanded query appending the formal synonyms as context
  return `${query} (policy terms: ${substitutions.join("; ")})`;
}

/**
 * Builds a concept-level query that elevates the question to its
 * HR policy topic area.
 *
 * E.g. "I got fired — what do I get?" →
 *      "employment termination and separation benefits and entitlements"
 */
function buildConceptVariant(query: string): string | null {
  const lower = query.toLowerCase();

  for (const [term, concept] of Object.entries(CONCEPT_MAP)) {
    if (lower.includes(term)) {
      // Combine the concept with key question words from the original query
      const questionWords = extractQuestionIntent(query);
      return questionWords
        ? `${concept} — ${questionWords}`
        : concept;
    }
  }

  return null;
}

/**
 * Extracts the "what the user wants to know" part of the question.
 * Strips personal pronouns and filler to get the core intent.
 */
function extractQuestionIntent(query: string): string {
  return query
    .replace(/^(what|how|when|where|who|why|can|do|does|will|is|are|am)\s+/i, "")
    .replace(/\b(i|me|my|we|our|you|your)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 100);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Expands a single query into up to 3 semantically distinct variants.
 *
 * Always includes the original query as the first element.
 * Additional variants are added only when they provide meaningfully different
 * semantic coverage — duplicates and near-duplicates are omitted.
 *
 * The caller should embed all returned strings and union the retrieval results.
 *
 * @param query — The user's (possibly rewritten) retrieval query.
 * @returns Array of 1–3 query strings. Always non-empty.
 */
export function expandQuery(query: string): string[] {
  const variants: string[] = [query];

  const formal = buildFormalVariant(query);
  if (formal && formal !== query) {
    variants.push(formal);
  }

  const concept = buildConceptVariant(query);
  if (concept && concept !== query && concept !== formal) {
    variants.push(concept);
  }

  return variants;
}
