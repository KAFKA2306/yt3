import fs from "fs-extra";
import yaml from "js-yaml";
import axios from "axios";

const data = yaml.load(fs.readFileSync("runs/2026-02-28/content/output.yaml", "utf-8"));
const script = data.script;
const missing = [73, 80, 85, 88, 89, 90, 93, 106, 108, 109];

for (const i of missing) {
  const line = script.lines[i];
  if (line) {
    console.log(`Line ${i}: speaker=${line.speaker} text=${line.text}`);
  } else {
    console.log(`Line ${i}: NOT FOUND`);
  }
}
