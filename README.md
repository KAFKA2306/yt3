# YT3: Autonomous Resonance Production Pipeline

A Zero-Fat, high-fidelity autonomous media generation system.

## 1. System Entry Point
All operations are governed via **Taskfile.yml**. 
```bash
task --list
```

## 2. Core Mandates (GEMINI.md)
- **Zero-Base Reasoning**: Validate requirements against current state.
- **Crash-Driven Development**: Fail loud and fast.
- **Zero-Trust Audit**: Mandatory deterministic verification of all media assets.

## 3. Directory Map
- `src/`: Production logic and agents.
- `db/`: Evolution and audit trace database (SQLite).
- `docs/`: ADRs and Audit Protocols.
- `runs/`: Immutable run logs and artifacts.
- `docs/standard/humanity-observatory-audit-standard.md`: Humanity Observatory System の編集監査基準書。

For detailed audit protocols, see [docs/AUDIT_PROTOCOL.md](docs/AUDIT_PROTOCOL.md).

## 4. Contract-bound local LLM publishing

The canonical local LLM contract is
`prompts/LOCAL_LLM_PUBLISH_DIRECTIVE.md`. Execute a job through the existing
pipeline with:

```bash
task publish:job -- --job=examples/kioxia_nand_2026-08-14.publish-job.yaml
```

The command prints `PUBLISH_RESULT=PASS` only after private staging,
processing/channel/media read-back audits, the requested visibility transition,
and an atomic verified `runs/<bucket>/<run>/publish/receipt.json`. A verified
receipt is re-audited without re-uploading; an upload intent without a receipt
stops as `UNCERTAIN_REMOTE_COMMIT`.
