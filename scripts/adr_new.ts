import fs from "node:fs";
import path from "node:path";

const ADR_DIR = "docs/adr";
const title = process.argv[2] || "new-decision";

if (!fs.existsSync(ADR_DIR)) {
    fs.mkdirSync(ADR_DIR, { recursive: true });
}

const files = fs.readdirSync(ADR_DIR).filter(f => f.endsWith(".md"));
const nextId = String(files.length + 1).padStart(4, "0");
const filename = `${nextId}-${title.toLowerCase().replace(/\s+/g, "-")}.md`;
const filepath = path.join(ADR_DIR, filename);

const template = `# ADR-${nextId}: ${title}

## Status
Accepted

## Context
[Describe the problem and context]

## Decision
[Describe the decision]

## Consequences
[Describe the consequences]
`;

fs.writeFileSync(filepath, template);
console.log(`✨ Created ADR: ${filepath}`);
