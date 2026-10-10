# Ontology Standard

## Purpose

This standard defines the shared terminology baseline and governance rules for ontology-related vocabulary in yt3.

## Normative Basis

- `ISO 5127:2017` and `ISO/IEC TR 20943-6:2013` provide the project-facing definition of ontology: a formal, explicit specification of a shared conceptualization.
- `ISO/IEC 21838-1:2021` defines requirements for a domain-neutral top-level ontology.
- `ISO/IEC 21838-2:2021` specifies BFO, `ISO/IEC 21838-3:2023` specifies DOLCE, and `ISO/IEC 21838-4:2023` specifies TUpper.
- `ISO/IEC DIS 21838-5` specifies UFO and remains a draft under development as of 2026-10-09.

## Mandatory Rules

1. Local vocabulary must be labeled as a `lexicon`, `registry`, or `local domain vocabulary` unless it is an actual international standard ontology.
2. No repository artifact may claim ISO ontology compliance without a direct reference to the standards listed above.
3. Ontology-like terms in project code or documentation must state their role relative to a top-level ontology.
4. The machine-checkable `task audit:ontology` is required before considering the repository ontology-compliant.

## Project Scope

- The `Humanity Observatory` vocabulary in `src/domain/humanity_audit/humanity_audit_terms.ts` is a local domain vocabulary.
- It is aligned to the standard basis above, but it is not itself an ISO top-level ontology.
- The project uses the reference definition for shared terminology and ISO/IEC 21838-1 as the top-level ontology requirements baseline; it does not claim to implement or comply with a particular ISO ontology.

## Layer Relation

The repository models data in three layers. Each layer has one role:

- **Ontology** (this document and `config/ontology/yt3.yaml`): what objects, relations, and actions mean.
- **Star schema** ([star-schema-standard.md](./star-schema-standard.md)): how objects are measured and analyzed, by grain.
- **Ledger** ([ledger-standard.md](./ledger-standard.md)): what happened, append-only, with evidence.

## Relations as Triples

Every relation is a triple `(source, predicate, target)`, written in `config/ontology/yt3.yaml` under `relations:`:

- `source` is the subject type ID, `target` is the object type ID, and both must be declared under `types:`.
- `predicate` is a snake_case verb phrase that reads from subject to object (`run has_audit_check audit-check`).
- `id` is a unique label for the triple. It is never used as a reference.
- A triple is only valid if it has `status` and `evidence`. Evidence points to the schema field or code that makes the relation true.

Triples are the only way to state a relation between objects. Ledger rows and star facts carry foreign keys, but their meaning is defined by the triple they instantiate.

Objects in the ontology are instantiated from ledger entries. Star facts are projections of the ledger. A term is defined here once, and the other two layers refer to it.

## Verification Expectations

- This document names the normative basis and governance rules.
- The local vocabulary file contains an explicit alignment note.
- `task audit:ontology` is exposed through the Taskfile and runs as part of the fast merge gate.

## References

- [ISO 5127](https://www.iso.org/obp/ui/es/)
- [ISO/IEC TR 20943-6](https://www.iso.org/obp/ui/en/)
- [ISO/IEC 21838-1](https://www.iso.org/standard/71954.html)
- [ISO/IEC 21838-2](https://www.iso.org/standard/74572.html)
- [ISO/IEC 21838-3](https://www.iso.org/standard/78927.html)
- [ISO/IEC 21838-4](https://www.iso.org/standard/78928.html)
- [ISO/IEC DIS 21838-5](https://www.iso.org/standard/89915.html)
