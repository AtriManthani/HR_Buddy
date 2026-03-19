# data/raw/ — Source Policy Documents

Place your original, unmodified HR policy documents here.
This directory is the **single source of truth** for all policy content.
Do not edit files in `data/processed/` or `data/chunks/` directly —
always edit the source here and re-run the pipeline.

---

## Supported file types

| Extension | Format | Notes |
|-----------|--------|-------|
| `.md` | Markdown | Preferred. Section headings (`#`, `##`) are used as citation anchors. |
| `.txt` | Plain text | Headings detected by ALL-CAPS or underline-style lines. |
| `.pdf` | PDF | Requires `pdf-parse` package (installed separately). Text extraction is best-effort; scanned PDFs are not supported. |
| `.docx` | Word | Requires `mammoth` package (installed separately). Formatting is stripped; only plain text is retained. |

> `.pdf` and `.docx` support is added in Phase 2 of the ingest script.
> For now, convert documents to `.md` or `.txt` before placing them here.

---

## Naming convention

Use lowercase kebab-case. The filename becomes the `sourceFile` metadata
field on every citation returned by the API.

```
annual-leave-policy.md
remote-work-policy.md
code-of-conduct.md
expense-reimbursement-policy.md
parental-leave-policy.pdf
```

Avoid spaces, special characters, and version suffixes in filenames.
If a document is versioned, update the file in-place and re-run the pipeline
rather than creating `annual-leave-policy-v2.md`.

---

## Document structure (for Markdown / plain text)

Well-structured documents produce better citations. Follow this layout:

```markdown
# Policy Title

**Effective date:** YYYY-MM-DD
**Owner:** HR Department

## 1. Purpose

[Policy purpose...]

## 2. Scope

[Who this policy applies to...]

## 3. Policy Details

### 3.1 Entitlements

[...]

## 4. Procedure

[...]

## 5. Related Policies

- Policy Name
- Policy Name
```

Key rules:
- Use a single `#` heading for the document title — this becomes `policyTitle` in citations.
- Use `##` or `###` headings for sections — these become the `section` field in citations.
- Keep paragraphs under ~300 words for better chunk coherence.
- Do not embed images, tables with complex merges, or non-ASCII characters that
  are meaningful to the policy text.

---

## What NOT to place here

- Files with sensitive personal employee data (performance reviews, salaries,
  disciplinary records) — these are not policy documents
- Draft or superseded policy versions — archive these outside the repo
- Documents with legal privilege — consult your legal team before ingesting
- Binary files other than `.pdf` and `.docx` (e.g. `.xlsx`, `.pptx`)

---

## Example documents

The following are illustrative example filenames for a typical HR policy set:

```
annual-leave-policy.md
sick-leave-policy.md
parental-leave-policy.md
remote-work-policy.md
expense-reimbursement-policy.md
code-of-conduct.md
anti-harassment-policy.md
performance-review-process.md
onboarding-checklist.md
data-privacy-policy.md
```
