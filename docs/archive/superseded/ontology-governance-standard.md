# Ontology Governance Standard

## Purpose
This standard defines how ontology-like vocabulary is handled in the yt3 repository.

## Normative Basis
- `ISO/IEC 21838-1:2021` defines the requirements for a domain-neutral top-level ontology.
- `ISO 5127:2017` and `ISO/IEC TR 20943-6:2013` provide the project-facing ontology definition used as the shared terminology baseline.

## Mandatory Rules
1. Local vocabulary must be labeled as `lexicon`, `registry`, or `domain vocabulary` unless it is an actual international standard ontology.
2. No repository artifact may claim ISO ontology compliance without a direct reference to the standards listed above.
3. Ontology-like terms in project code or docs must explicitly state their role relative to the top-level ontology.
4. The machine-checkable audit `task audit:ontology` is required before considering the repository ontology-compliant.

## Project Scope
- The `Humanity Observatory` vocabulary in `src/domain/humanity_audit/humanity_audit_terms.ts` is a local domain vocabulary.
- It is aligned to the standard basis above, but it is not itself an ISO top-level ontology.

## Verification Expectations
- The reference document exists and names the standard basis.
- The local vocabulary file contains an explicit alignment note.
- The repository exposes a dedicated ontology audit task.
