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

For detailed audit protocols, see [docs/AUDIT_PROTOCOL.md](docs/AUDIT_PROTOCOL.md).
