/**
 * lib/demo/demoHandler.ts — Demo mode request handler.
 *
 * Activated when DEMO_MODE=true is set in the environment.
 * Intercepts the POST /api/chat request and returns a pre-crafted, fully
 * realistic response — correct NDJSON streaming format, citation cards,
 * recommendation banners — without calling the OpenAI API or the vector store.
 *
 * Purpose: enables a live Vercel demo deployment without requiring a live
 * OpenAI API key.  The responses are based on the actual policy documents
 * in data/raw/ and match the output format of the real pipeline exactly.
 *
 * To activate: set DEMO_MODE=true in Vercel environment variables.
 * To deactivate: remove DEMO_MODE or set it to any value other than "true".
 */

import { randomUUID } from "crypto";
import {
  createNdJsonStream,
  streamText,
  metadataChunk,
  tokenChunk,
} from "@/lib/api/responseBuilder";
import type { Citation, Recommendation, StructuredResponse } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DemoEntry {
  /** Full markdown answer text — streamed token by token. */
  text: string;
  citations: Citation[];
  recommendations: Recommendation[];
  structuredResponse: StructuredResponse;
}

// ── Citation factory ───────────────────────────────────────────────────────────

function cite(
  policyTitle: string,
  sourceFile: string,
  section: string,
  pageOrLine: number,
  policyCategory: string,
  excerpt: string,
  score: number,
): Citation {
  return {
    id: randomUUID(),
    policyTitle,
    sourceFile,
    section,
    pageOrLine,
    policyCategory,
    excerpt,
    score,
  };
}

// ── Demo response library ──────────────────────────────────────────────────────
//
// Each entry corresponds to a topic a user is likely to ask about.
// Responses are written to reflect the actual policy documents in data/raw/.
// Tone is professional, concise, and consistent with the real pipeline output.

const ENTRIES: Record<string, DemoEntry> = {

  // ── Vacation / Annual Leave ──────────────────────────────────────────────────

  vacation: {
    text: `## Annual Leave Entitlement

Full-time regular employees accrue **10 vacation days** per year during their first three years of service, increasing to **15 days** per year after three years and **20 days** per year after seven years of continuous employment.

### Key Rules

- Vacation accrual begins on your first day of employment
- Unused vacation may be carried over into the following calendar year, up to a maximum of **10 days**
- Requests for leave of three or more consecutive days must be submitted at least **5 business days** in advance
- Vacation pay is calculated at your regular base rate of pay

### Requesting Leave

Submit requests through the HR portal or notify your direct supervisor. Approval is at the manager's discretion based on business needs and team coverage requirements.

> Part-time employees accrue vacation on a pro-rated basis proportional to their contracted hours.`,

    citations: [
      cite(
        "Vacation Leave Policy",
        "Vacation-Policy-2023-11-15.pdf",
        "I. Vacation Leave",
        1,
        "Leave & Benefits",
        "All regular full-time employees shall accrue vacation leave at the rate of ten (10) days per year for the first three years of continuous service, increasing to fifteen (15) days per year after three years and twenty (20) days per year after seven years.",
        0.921,
      ),
      cite(
        "Vacation Leave Policy",
        "Vacation-Policy-2023-11-15.pdf",
        "II. Carryover and Payout",
        2,
        "Leave & Benefits",
        "Unused vacation leave may be carried over to the following calendar year, subject to a maximum accrual cap of ten (10) days. Leave accrued above the cap is forfeited at year end.",
        0.876,
      ),
    ],

    recommendations: [
      {
        type: "eligibility",
        headline: "Check your current accrual balance",
        detail:
          "Your exact entitlement depends on your length of service and employment classification. Verify your current balance in the HR portal before planning extended time off.",
      },
    ],

    structuredResponse: {
      answer:
        "Full-time employees accrue 10 vacation days per year for their first 3 years, increasing to 15 days after 3 years and 20 days after 7 years. Unused leave can be carried over up to a maximum of 10 days.",
      explanation:
        "Vacation entitlements are governed by the Vacation Leave Policy (November 2023). Accrual rates and carryover limits apply to all regular employees. Part-time employees accrue on a pro-rated basis.",
      relatedPolicies: [
        { title: "Paid Safe Leave Policy", category: "Leave & Benefits" },
        { title: "Paid Parental Leave Policy", category: "Leave & Benefits" },
      ],
    },
  },

  // ── Sick Leave ───────────────────────────────────────────────────────────────

  sick: {
    text: `## Sick Leave Policy

Employees are entitled to **10 paid sick days** per calendar year. Sick leave covers absences due to personal illness or injury, medical and dental appointments, and caring for an immediate family member.

### Accrual and Availability

- Sick leave is front-loaded at the **start of each calendar year** and does not carry over
- New employees hired after July 1 receive a **pro-rated allocation** for the remainder of that year
- Unused sick leave is **not paid out** upon separation from employment

### Notification Requirements

- Notify your supervisor **before the start of your scheduled shift** wherever possible
- Absences exceeding **3 consecutive days** may require a physician's note upon return
- Extended illness beyond available sick leave may qualify for FMLA or other applicable leave programs

### Protected Usage

Under applicable state and local laws, sick leave cannot be denied for qualifying reasons, including care for a family member with a serious health condition or recovery from domestic violence.`,

    citations: [
      cite(
        "HR Policies — Section A",
        "HR-Policies-Section-A-2025-07-28.pdf",
        "Sick Leave",
        4,
        "Leave & Benefits",
        "Employees are entitled to ten (10) paid sick days per calendar year, provided at the start of each calendar year. Sick leave may be used for personal illness, injury, medical appointments, or care of an immediate family member.",
        0.908,
      ),
      cite(
        "Paid Safe Leave Policy",
        "Paid-Safe-Leave-Policy-2024-09-16.pdf",
        "Eligibility and Protected Usage",
        1,
        "Leave & Benefits",
        "Sick leave may not be denied for reasons protected under applicable local and state safe leave statutes, including domestic violence, stalking, sexual assault, and family member care requirements.",
        0.783,
      ),
    ],

    recommendations: [
      {
        type: "documentation",
        headline: "A physician's note may be required",
        detail:
          "Absences of 3 or more consecutive days typically require medical documentation. Contact HR before your return to confirm what is needed for your specific situation.",
      },
    ],

    structuredResponse: {
      answer:
        "Employees receive 10 paid sick days per calendar year, provided at the start of each year. Absences over 3 consecutive days may require a physician's note.",
      explanation:
        "Sick leave provisions are covered in HR Policies Section A (2025). For extended illness, FMLA or state leave protections may provide additional coverage beyond available sick days.",
      relatedPolicies: [
        { title: "Vacation Leave Policy", category: "Leave & Benefits" },
        { title: "Paid Parental Leave Policy", category: "Leave & Benefits" },
      ],
    },
  },

  // ── Performance Review ───────────────────────────────────────────────────────

  performance: {
    text: `## Performance Review Process

The organization conducts **two formal performance reviews per year** — a mid-year check-in in June and a comprehensive annual appraisal in December.

### What Is Assessed

Reviews evaluate employees across four dimensions:

1. **Goal Achievement** — Progress against objectives set at the beginning of the review period
2. **Competency Demonstration** — Application of role-specific and organizational competencies
3. **Collaboration & Communication** — Contribution to team effectiveness and cross-functional work
4. **Professional Development** — Skill-building and growth activities undertaken during the period

### Ratings Scale

Performance is rated on a **5-point scale**:

| Rating | Label | Meaning |
|--------|-------|---------|
| 5 | Exceptional | Consistently exceeds all expectations |
| 4 | Exceeds Expectations | Regularly surpasses key objectives |
| 3 | Meets Expectations | Achieves all core objectives |
| 2 | Development Needed | Partially meets expectations |
| 1 | Unsatisfactory | Does not meet core objectives |

### Outcome Implications

- Ratings of **4 or 5** make employees eligible for merit increases and promotion consideration
- Ratings of **2 or below** result in a formal **Performance Improvement Plan (PIP)** within 30 days`,

    citations: [
      cite(
        "HR Policies — Section B",
        "HR-Policies-Section-B-2025-07-23.pdf",
        "Performance Management",
        8,
        "General HR Policy",
        "The performance review cycle consists of a mid-year progress review conducted in June and a comprehensive annual appraisal conducted in December. Both reviews are conducted by the employee's direct manager.",
        0.894,
      ),
      cite(
        "HR Policies — Section B",
        "HR-Policies-Section-B-2025-07-23.pdf",
        "Performance Improvement Plans",
        10,
        "General HR Policy",
        "Employees receiving a rating of 2 (Development Needed) or 1 (Unsatisfactory) shall be placed on a formal Performance Improvement Plan within 30 days of the completion of their annual review.",
        0.851,
      ),
    ],

    recommendations: [
      {
        type: "complexity",
        headline: "Merit increases are linked to review outcomes",
        detail:
          "Compensation adjustments resulting from performance reviews are processed in January. Speak with your manager or HR Business Partner to understand how your rating affects your compensation.",
      },
    ],

    structuredResponse: {
      answer:
        "Performance reviews are held twice yearly — a mid-year check-in in June and an annual appraisal in December. Employees are rated on a 5-point scale across goals, competencies, collaboration, and development.",
      explanation:
        "The performance management framework is documented in HR Policies Section B (July 2025). The process applies to all regular employees who have completed their 90-day introductory period.",
    },
  },

  // ── Remote Work ──────────────────────────────────────────────────────────────

  remote: {
    text: `## Remote and Hybrid Work Guidelines

The organization supports hybrid work for eligible roles. Employees may work remotely up to **3 days per week**, with a minimum of **2 in-office days** required each week.

### Eligibility Criteria

Remote work arrangements are available to employees who:
- Have completed at least **6 months** of continuous employment
- Hold a role classified as remote-eligible by their department head
- Maintain a performance rating of **Meets Expectations (3)** or above
- Have a suitable, private, and secure home work environment

### Requirements on Remote Days

- **Core hours of 9:00 AM – 3:00 PM** (local time) must be observed on all days
- Employees must be reachable by phone, email, and video during core hours
- A reliable internet connection of at least **25 Mbps** is required
- Company data must be accessed via the **corporate VPN** at all times when working off-site

### Equipment and Expenses

The company provides a **standard equipment kit** (laptop and headset) for all approved remote workers. Additional peripherals and home internet costs are the employee's responsibility and are not reimbursed.

### Requesting a Remote Arrangement

Submit a remote work request to your manager and HR. Arrangements are reviewed quarterly and may be adjusted based on business needs or changes in performance.`,

    citations: [
      cite(
        "HR Policies — Section C",
        "HR-Policies-Section-C-2025-07-10.pdf",
        "Remote and Hybrid Work",
        12,
        "General HR Policy",
        "Eligible employees may work remotely up to three (3) days per calendar week. A minimum of two (2) in-office days per week is required for all hybrid-eligible roles. Arrangements must be approved by the employee's manager and documented in the HR system.",
        0.917,
      ),
      cite(
        "HR Policies — Section C",
        "HR-Policies-Section-C-2025-07-10.pdf",
        "Remote Work Equipment and Expenses",
        14,
        "General HR Policy",
        "The organization will provide a standard equipment kit consisting of a laptop and headset to all approved remote workers. Additional equipment, peripherals, and home internet costs are the responsibility of the employee and will not be reimbursed.",
        0.845,
      ),
    ],

    recommendations: [
      {
        type: "eligibility",
        headline: "Confirm your role is remote-eligible",
        detail:
          "Not all positions qualify for hybrid arrangements. Your manager and HR Business Partner can confirm whether your specific role is approved and help you submit the required documentation.",
      },
    ],

    structuredResponse: {
      answer:
        "Eligible employees may work remotely up to 3 days per week, with a minimum of 2 in-office days required. Eligibility requires 6 months of service, a remote-eligible role, and a Meets Expectations rating.",
      explanation:
        "Remote and hybrid work guidelines are set out in HR Policies Section C (July 2025). Individual arrangements must be approved by the employee's manager and formally documented.",
    },
  },

  // ── Parental Leave ───────────────────────────────────────────────────────────

  parental: {
    text: `## Paid Parental Leave

The organization provides **12 weeks of fully paid parental leave** for all eligible employees following the birth, adoption, or foster placement of a child.

### Eligibility

To qualify, employees must:
- Have completed **12 months** of continuous employment prior to the leave start date
- Be the primary or co-caregiver of the new child
- Provide supporting documentation (birth certificate, adoption order, or foster placement letter)

### Key Terms

- Birth parents may begin leave up to **2 weeks before** the expected due date
- Both birth parents and non-birth parents (including same-sex partners) are eligible
- Leave must ordinarily be taken as a **continuous block**; phased arrangements require HR approval
- Paid parental leave runs **concurrently with FMLA** where applicable

### Phased Return

Employees returning from parental leave may request a reduced-hours schedule for up to **4 weeks**, subject to manager and HR approval.

### Extended Leave

Employees who exhaust their 12-week paid entitlement may request up to **4 additional weeks of unpaid leave**. Benefits continue during unpaid leave.`,

    citations: [
      cite(
        "Paid Parental Leave Policy",
        "Paid-Parental-Leave-Policy-2023-08-17.pdf",
        "Eligibility and Duration",
        1,
        "Leave & Benefits",
        "Eligible employees are entitled to twelve (12) weeks of fully paid parental leave following the birth, adoption, or foster placement of a child, subject to the eligibility requirements set forth in this policy.",
        0.945,
      ),
      cite(
        "Paid Parental Leave Policy",
        "Paid-Parental-Leave-Policy-2023-08-17.pdf",
        "Phased Return to Work",
        3,
        "Leave & Benefits",
        "An employee returning from parental leave may request a phased return schedule of reduced hours for a period not to exceed four (4) weeks, subject to approval by the employee's manager and Human Resources.",
        0.882,
      ),
    ],

    recommendations: [
      {
        type: "documentation",
        headline: "Notify HR at least 30 days in advance",
        detail:
          "Notify HR and your manager as early as possible — ideally at least 30 days before your expected leave start date — to ensure pay continuation is properly arranged.",
      },
    ],

    structuredResponse: {
      answer:
        "Eligible employees receive 12 weeks of fully paid parental leave following birth, adoption, or foster placement. Both birth and non-birth parents are eligible after 12 months of service.",
      explanation:
        "Parental leave entitlements are governed by the Paid Parental Leave Policy (August 2023). Employees in jurisdictions with additional local paid family leave laws may have supplementary entitlements.",
      relatedPolicies: [
        { title: "PUMP Act Policy", category: "Leave & Benefits" },
        { title: "PWFA Policy", category: "Leave & Benefits" },
      ],
    },
  },

  // ── Harassment / Discrimination ──────────────────────────────────────────────

  harassment: {
    text: `## Anti-Discrimination and Anti-Harassment Policy

The organization maintains a **zero-tolerance policy** for discrimination, harassment, and retaliation of any kind. All employees are entitled to work in an environment that respects their dignity and treats them fairly.

### Protected Characteristics

Discrimination or harassment based on any of the following is strictly prohibited:
- Race, color, national origin, or ancestry
- Sex, gender identity, or sexual orientation
- Age, disability status, or pregnancy
- Religion, marital status, or military/veteran status
- Any other characteristic protected by applicable federal, state, or local law

### What Constitutes Harassment

Prohibited conduct includes:
- **Verbal:** Slurs, derogatory comments, offensive jokes, or threats
- **Physical:** Unwanted touching, blocking movement, or intimidation
- **Visual:** Displaying offensive images, symbols, or written materials
- **Digital:** Offensive emails, messages, or social media conduct directed at a colleague

### How to Report

1. Report to your **direct supervisor**, **HR Department**, or the **anonymous Ethics Hotline**
2. All reports are investigated promptly, thoroughly, and confidentially
3. **Retaliation** against any employee who reports in good faith is strictly prohibited and is itself a policy violation subject to disciplinary action up to and including termination`,

    citations: [
      cite(
        "Anti-Discrimination and Anti-Harassment Policy",
        "Anti-Discrimination-Anti-Harassment-Policy-2024-03-25.pdf",
        "Policy Statement",
        1,
        "Workplace Safety",
        "The organization prohibits all forms of discrimination and harassment based on race, color, sex, gender identity, sexual orientation, age, disability, religion, national origin, or any other characteristic protected by applicable federal, state, or local law.",
        0.932,
      ),
      cite(
        "Anti-Discrimination and Anti-Harassment Policy",
        "Anti-Discrimination-Anti-Harassment-Policy-2024-03-25.pdf",
        "Reporting and Non-Retaliation",
        4,
        "Workplace Safety",
        "Any employee who believes they have been subjected to discrimination or harassment should report the conduct promptly to Human Resources or via the Ethics Hotline. Retaliation against any employee who reports in good faith is strictly prohibited.",
        0.899,
      ),
    ],

    recommendations: [
      {
        type: "cross-policy",
        headline: "Sexual harassment has a dedicated policy",
        detail:
          "Detailed procedures specific to sexual harassment — including investigation steps and corrective actions — are contained in the Sexual Harassment Policy (March 2024).",
      },
    ],

    structuredResponse: {
      answer:
        "The organization has a zero-tolerance policy for discrimination and harassment based on any protected characteristic. Incidents should be reported to HR or the anonymous Ethics Hotline. Retaliation is strictly prohibited.",
      explanation:
        "The Anti-Discrimination and Anti-Harassment Policy (March 2024) applies to all employees, contractors, and third parties operating within company premises or systems.",
      relatedPolicies: [
        { title: "Sexual Harassment Policy", category: "Workplace Safety" },
        { title: "Workplace Violence Policy", category: "Workplace Safety" },
      ],
    },
  },

  // ── Ethics / Code of Conduct ─────────────────────────────────────────────────

  ethics: {
    text: `## Code of Conduct and Ethics

All employees are expected to conduct themselves with **integrity, honesty, and professionalism** in every business interaction. The code of conduct applies to all employees, contractors, and representatives acting on behalf of the organization.

### Core Principles

1. **Honesty** — Provide accurate, complete information in all communications
2. **Integrity** — Act consistently with stated values and policies at all times
3. **Respect** — Treat every individual with dignity regardless of role or background
4. **Accountability** — Take responsibility for your decisions and their outcomes

### Conflicts of Interest

You must disclose and avoid situations where personal interests may conflict with organizational interests, including:
- Outside employment or business ventures that compete with or supply the organization
- Financial interests in vendors, suppliers, or competitors
- Personal relationships that could influence business decisions

### Protecting Confidential Information

- Do not share proprietary, client, or personnel data with unauthorized parties
- Non-disclosure obligations survive the end of your employment
- Data privacy laws and company data handling policies must be followed at all times

### Reporting Violations

Use the **Ethics Hotline** (available 24/7, anonymous) to report suspected violations. Good-faith reports are fully protected from retaliation.`,

    citations: [
      cite(
        "Ethics and Law Overview",
        "EthicsLawOverview.pdf",
        "Core Conduct Standards",
        2,
        "Ethics & Compliance",
        "Employees are expected to conduct themselves with honesty and integrity at all times. This includes accurate reporting, avoidance of conflicts of interest, and the protection of confidential and proprietary information.",
        0.911,
      ),
      cite(
        "HR Policies — Section C",
        "HR-Policies-Section-C-2025-07-10.pdf",
        "Conflicts of Interest",
        18,
        "General HR Policy",
        "Employees must disclose any outside employment, financial interest, or personal relationship that may create an actual or perceived conflict of interest. Disclosures must be made in writing to HR prior to engaging in the outside activity.",
        0.834,
      ),
    ],

    recommendations: [
      {
        type: "documentation",
        headline: "Conflicts of interest require written disclosure",
        detail:
          "If you have a potential conflict of interest, disclose it to HR in writing before proceeding. Undisclosed conflicts may result in disciplinary action up to and including termination.",
      },
    ],

    structuredResponse: {
      answer:
        "All employees must act with honesty, integrity, and professionalism. Conflicts of interest must be disclosed in writing to HR. Confidential information must be protected. Violations can be reported anonymously via the Ethics Hotline.",
      explanation:
        "Conduct standards are governed by the Ethics and Law Overview document and HR Policies Section C. These apply to all employees and contractors.",
    },
  },

  // ── Default fallback ─────────────────────────────────────────────────────────

  default: {
    text: `## HR Policy Assistant

I can answer questions about your organization's official HR policies. Here are the topics I cover:

**Leave & Benefits**
- Vacation and annual leave entitlements
- Sick leave and medical leave
- Paid parental leave
- Paid safe leave

**Workplace Conduct**
- Anti-discrimination and anti-harassment
- Sexual harassment policy
- Workplace violence and safety
- Drug and alcohol policy

**Performance & Development**
- Performance review process and ratings
- Performance improvement plans

**Working Arrangements**
- Remote and hybrid work guidelines
- Equipment and expense policies

**Ethics & Compliance**
- Code of conduct
- Conflicts of interest
- Confidentiality obligations

### Try asking

- *"How many vacation days am I entitled to?"*
- *"What is the sick leave policy?"*
- *"How does the performance review work?"*
- *"What are the remote work guidelines?"*
- *"What is the parental leave entitlement?"*`,

    citations: [
      cite(
        "HR Policies — Section A",
        "HR-Policies-Section-A-2025-07-28.pdf",
        "General Provisions",
        1,
        "General HR Policy",
        "These HR policies apply to all regular full-time and part-time employees of the organization. Policies are reviewed annually and updated to reflect changes in applicable law and organizational priorities.",
        0.712,
      ),
    ],

    recommendations: [
      {
        type: "low-confidence",
        headline: "Ask about a specific topic for a precise answer",
        detail:
          "Asking about a specific policy — such as vacation leave, sick days, performance reviews, or remote work — will give you a detailed, cited answer from the official documents.",
      },
    ],

    structuredResponse: {
      answer:
        "I can answer questions about leave entitlements, performance reviews, remote work, conduct policies, and more. Try asking about a specific topic to get a detailed, cited answer.",
    },
  },
};

// ── Topic matcher ──────────────────────────────────────────────────────────────

function matchTopic(message: string): DemoEntry {
  const m = message.toLowerCase();

  if (/vacation|annual leave|days off|time off|leave entitl|holiday|pto/.test(m))
    return ENTRIES.vacation;

  if (/sick|sick leave|medical leave|illness|unwell|doctor|injury/.test(m))
    return ENTRIES.sick;

  if (/performance|review|appraisal|evaluation|pip|rating|assess/.test(m))
    return ENTRIES.performance;

  if (/remote|hybrid|work from home|wfh|telework|home office|work.{0,10}home/.test(m))
    return ENTRIES.remote;

  if (/parental|maternity|paternity|baby|birth|adopt|foster|child/.test(m))
    return ENTRIES.parental;

  if (/harass|discriminat|bully|hostile|sexual|assault|retaliat/.test(m))
    return ENTRIES.harassment;

  if (/ethics|conduct|integrity|conflict of interest|confidential|hotline/.test(m))
    return ENTRIES.ethics;

  return ENTRIES.default;
}

// ── Public handler ─────────────────────────────────────────────────────────────

/**
 * Handles the full POST /api/chat request in demo mode.
 *
 * Reads the message from the request body, matches it to a topic,
 * and streams the pre-crafted response using the exact same NDJSON
 * format produced by the real pipeline.
 *
 * Token delay of 15 ms simulates real streaming speed — fast enough
 * to feel live, slow enough to show the streaming animation clearly.
 */
export async function handleDemoRequest(req: Request): Promise<Response> {
  let message = "";
  let sessionId: string | null = null;

  try {
    const body = (await req.json()) as { message?: unknown; sessionId?: unknown };
    message    = typeof body.message   === "string" ? body.message   : "";
    sessionId  = typeof body.sessionId === "string" ? body.sessionId : null;
  } catch {
    // Malformed body — proceed with empty message → default response
  }

  const entry   = matchTopic(message);
  const outSessionId = sessionId ?? randomUUID();

  // Token stream delay in ms.  15 ms ≈ 67 tokens/sec — realistic typing speed.
  const TOKEN_DELAY_MS = 15;

  return createNdJsonStream(async (write) => {
    // Stream the answer text token by token
    await streamText(entry.text, write, TOKEN_DELAY_MS);

    // Send the metadata chunk (citations, recommendations, structured response)
    write(
      metadataChunk({
        sessionId:          outSessionId,
        citations:          entry.citations,
        recommendations:    entry.recommendations,
        structuredResponse: entry.structuredResponse,
      }),
    );
  });
}

// Suppress unused-import warning — tokenChunk is re-exported for test convenience
export { tokenChunk };
