from pathlib import Path


def cut(text: str, start: str, end: str, replacement: str, label: str) -> str:
    if start not in text or end not in text[text.index(start):]:
        raise SystemExit(f"missing range: {label}")
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + replacement + text[b:]

p = Path("src/domain/agents/audit.ts")
t = p.read_text()

# Remove LLM audience-prediction schema.
t = cut(
    t,
    "\nconst AudienceAuditResultSchema = z.object({",
    "\nconst HumanityAuditResultSchema = z.object({",
    "\n",
    "audience schema",
)

# Remove LLM audience-prediction invocation; deterministic retention follows immediately.
t = cut(
    t,
    "\n\t\t// 5.6 AUDIENCE AUDIT",
    "\n\t\t// 5.7 DETERMINISTIC RETENTION AUDIT",
    "\n",
    "audience call",
)

# Remove placeholder brand audit invocation; real humanity and voice audits remain.
t = cut(
    t,
    "\n\t\t// 5.13 MULTI-MODAL BRAND INTEGRITY AUDIT",
    "\n\t\t// 5.14 SCRIPT INTEGRITY AUDIT",
    "\n",
    "brand call",
)

# Placeholder brand method had hardcoded PASS values without measurements.
t = cut(
    t,
    "\n\tprivate async auditBrandStyle(",
    "\n\tprivate auditNamingBoundaries(",
    "\n",
    "placeholder brand method",
)

# LLM audience prediction duplicates deterministic retention/freshness.
t = cut(
    t,
    "\n\tprivate async auditAudience(",
    "\n\tprivate checkProvenance(",
    "\n",
    "audience method",
)

p.write_text(t)

forbidden = [
    "AudienceAuditResultSchema",
    "auditAudience(",
    "auditBrandStyle(",
    'status: "PASS", // Will FAIL if histogram tool detects',
    "Visual style aligned with 'mundane life' fragments.",
    "Pitch variance and energy contour match 'conversational closeness'.",
]
for file in Path("src").rglob("*.ts"):
    text = file.read_text(errors="ignore")
    hits = [needle for needle in forbidden if needle in text]
    if hits:
        raise SystemExit(f"stale synthetic audit reference in {file}: {hits}")

# Restore normal CI and remove this migration helper before committing.
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
