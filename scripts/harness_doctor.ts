import fs from "node:fs";
import path from "node:path";

console.log("🔍 Scanning for repository rot...");

// 1. Check for stale diagram links in README
const readme = fs.readFileSync("README.md", "utf-8");
const links = readme.match(/\[.*\]\((docs\/diagrams\/.*\.md)\)/g) || [];

for (const link of links) {
    const target = link.match(/\((docs\/diagrams\/.*\.md)\)/)?.[1];
    if (target && !fs.existsSync(target)) {
        console.warn(`🚨 Stale link found in README: ${target} (File does not exist)`);
    }
}

// 2. Check for dummy tests
const testFile = "src/index.test.ts";
if (fs.existsSync(testFile)) {
    const content = fs.readFileSync(testFile, "utf-8");
    if (content.includes("expect(true).toBe(true)") && content.length < 200) {
        console.warn(`🚨 Dummy test detected in ${testFile}! Please write real tests.`);
    }
}

console.log("✅ Scan complete.");
