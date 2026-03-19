# data/processed/ — Extracted Plain Text

This directory holds the plain-text representation of every document in
`data/raw/`. One `.txt` file is produced per source document by
`scripts/extract.ts` (Stage 1 of the pipeline).

**Do not edit these files manually.** They are derived artifacts.
If a source document needs correction, fix it in `data/raw/` and re-run
Stage 1.

---

## File naming

Each processed file mirrors its source document name with a `.txt` extension:

```
data/raw/annual-leave-policy.md    →  data/processed/annual-leave-policy.txt
data/raw/remote-work-policy.pdf    →  data/processed/remote-work-policy.txt
data/raw/code-of-conduct.docx      →  data/processed/code-of-conduct.txt
```

---

## Content format

Processed files are UTF-8 plain text with:

- All original headings preserved (important — the chunker uses them as section boundaries)
- HTML tags stripped (for `.docx` sources)
- Ligatures and smart quotes normalised to ASCII equivalents
- Consecutive blank lines collapsed to a single blank line
- No page headers, footers, or watermarks

### Example

```text
Annual Leave Policy

Effective date: 2024-01-01
Owner: HR Department

1. Purpose

This policy sets out the annual leave entitlements for all permanent
and fixed-term employees of Acme Corp.

2. Scope

This policy applies to all employees employed for more than three months,
excluding contractors and agency workers.

3. Entitlements

3.1 Standard Entitlement

All eligible employees are entitled to 20 days of paid annual leave per
calendar year, pro-rated for part-time employees.
```

---

## Git treatment

Processed files **may** be committed to the repository for small document sets
(< 50 documents, < 5 MB total), which allows the chunking step to run without
re-extracting from source on every clone.

For large document sets, add `data/processed/` to `.gitignore` and re-run
`npm run extract` after cloning.
