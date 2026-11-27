---
name: readiness-governance-privacy
description: Use when reading or explaining D5 (governance and privacy) or gates G2, G3 and G4 of a readiness assessment — owners, the personal-data scan, need and legal basis, what is not evaluated, and the escalations to Legal / Privacy.
---

# Governance and privacy (D5)

Tools for this skill: [[tool:ask_clarification]].

[[tool:assess_readiness]] scans for personal data and decides D5, G2, G3 and G4; you read and explain them.

## What assess_readiness measures
1. Owners: from `owners` on the scope card. No owner for a critical dataset: G2.
2. Personal data: a scan, in code over a sample, for email, phone, card number and national id patterns and for column-name hints. It returns the types and the match rates only, never a value.
3. Need: `personalDataNeeded` on the card. Personal data the use does not need, unclassified and unmasked: G4. Recommend excluding, masking or aggregating it.
4. Legal basis: `legalBasis` on the card. Personal data without a documented legal basis or a compatible purpose: G3, and always an escalation to Legal / Privacy.

## Always not evaluated here
Classification labels, access policies and roles, retention, access audit, and whether policy allows the data in AI models or with external AI providers. Say so.

## Rules
- Never write a personal value, not even as an example: types, columns and rates only ("3 % of `notes` values look like email addresses").
- Every legal finding reads "needs Legal / Privacy review". You give no legal opinion; name the applicable law only when the requester did (for example, Colombia's Law 1581 of 2012, or the GDPR).
- When the requester gives a legal basis or an owner, update the card and assess again with [[tool:assess_readiness]]; never flip a gate yourself.

## Output
A controls table (control, status, evidence id), the personal-data finding (types and columns, no values), the status of G2, G3 and G4, and D5's level, as returned.
