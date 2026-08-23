from pathlib import Path

p = Path("src/domain/agents/audit.ts")
t = p.read_text()
old = '''\t\tconst signalResults = await this.auditSignals(state, evidence);\n\t\tif (\n\t\t\tstate.bucket === "humanity_observatory" &&\n\t\t\tsignalResults.multimodal_pacing\n\t\t) {\n\t\t\tsignalResults.multimodal_pacing.status = "PASS";\n\t\t\tsignalResults.multimodal_pacing.details += ` (Bypassed for ${state.bucket} production requirements)`;\n\t\t}\n\t\tObject.assign(results, signalResults);'''
new = '''\t\tconst signalResults = await this.auditSignals(state, evidence);\n\t\tObject.assign(results, signalResults);'''
if old not in t:
    raise SystemExit("humanity pacing bypass block not found")
t = t.replace(old, new, 1)
if "Bypassed for ${state.bucket} production requirements" in t:
    raise SystemExit("stale pacing bypass remains")
p.write_text(t)

Path(".github/workflows/ci.yml").write_text('''name: CI

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]

jobs:
  merge-gate:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v4

    - name: Setup Bun
      uses: oven-sh/setup-bun@v2
      with:
        bun-version: 1.3.14

    - name: Install dependencies from lockfile
      run: bun ci

    - name: PR merge gate
      run: bun run check:merge
''')
Path(__file__).unlink()
