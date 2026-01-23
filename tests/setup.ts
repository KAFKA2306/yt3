
import process from 'node:process';

// ENFORCE GLOBAL CONSTRAINTS
// This file is imported by test files to ensure environment is set correctly
process.env.SKIP_LLM = 'true';
process.env.DRY_RUN = 'true';
process.env.NODE_ENV = 'test';

console.log('[TEST SETUP] Enforcing SKIP_LLM=true and DRY_RUN=true');


