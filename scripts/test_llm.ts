import { createLlm } from "../src/core.js";

async function main() {
  console.log("Testing LLM...");
  try {
    const llm = createLlm();
    const res = await llm.invoke("Hello, are you working?");
    console.log("Response:", res);
    console.log("Content:", res.content);
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
