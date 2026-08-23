from pathlib import Path


def cut(text: str, start: str, end: str, replacement: str, label: str) -> str:
    if start not in text or end not in text[text.index(start):]:
        raise SystemExit(f"missing range: {label}")
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + replacement + text[b:]

p = Path("src/domain/agents/audit.ts")
t = p.read_text()

# Remove the LLM semantic scoring schema.
t = cut(
    t,
    "\nconst SemanticAuditResultSchema = z.object({",
    "\nconst HumanityAuditResultSchema = z.object({",
    "\n",
    "semantic schema",
)

# Deterministic retention/freshness already cover the concrete checks.
t = cut(
    t,
    "\n\t\t// 3. SEMANTIC AUDIT",
    "\n\t\t// 4. VOICE ROLE INTEGRITY",
    "\n",
    "semantic call",
)

t = cut(
    t,
    "\n\tprivate async auditSemantics(",
    "\n\tprivate getPastRunsState(",
    "\n",
    "semantic method",
)

# QuotaExhaustionError was used only to convert semantic audit outages into PASS.
without_import = t.replace("\n\tQuotaExhaustionError,", "")
if "QuotaExhaustionError" not in without_import:
    t = without_import

p.write_text(t)

forbidden = [
    "SemanticAuditResultSchema",
    "auditSemantics(",
    "Bypassed due quota exhaustion",
    'status: isQuota ? "PASS"',
]
for file in Path("src").rglob("*.ts"):
    text = file.read_text(errors="ignore")
    hits = [needle for needle in forbidden if needle in text]
    if hits:
        raise SystemExit(f"stale fail-open semantic audit reference in {file}: {hits}")

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
