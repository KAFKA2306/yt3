/**
 * check_keys.ts
 * Diagnostic tool for validating multiple Gemini API keys.
 * Part of the 'llm-round-robin' skill.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

async function validateKey(keyName: string, keyValue: string): Promise<boolean> {
  const genAI = new GoogleGenerativeAI(keyValue);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  try {
    // Attempt a minimal 1-token response
    const result = await model.generateContent("ping");
    const text = result.response.text();
    return !!text;
  } catch (error) {
    console.error(`[FAIL] Key ${keyName}: ${error instanceof Error ? error.message : "Unknown error"}`);
    return false;
  }
}

async function main() {
  const keys = Object.entries(process.env).filter(([name]) => 
    name.startsWith("GEMINI_API_KEY") && name !== "GEMINI_API_KEY" // Ignore the generic one if specific ones exist
  );

  if (keys.length === 0) {
    console.warn("[WARN] No numbered Gemini API keys found. Defaulting to standard flow.");
    return;
  }

  console.log(`[INIT] Found ${keys.length} Gemini API keys. Starting validation...`);

  const results = await Promise.all(keys.map(([name, value]) => validateKey(name, value as string)));
  const validKeysCount = results.filter(Boolean).length;

  if (validKeysCount === 0) {
    console.error("[CRITICAL] No valid Gemini API keys found. Terminating.");
    process.exit(1);
  }

  console.log(`[SUCCESS] ${validKeysCount}/${keys.length} keys are valid and ready for Round-Robin.`);
}

main().catch(console.error);
