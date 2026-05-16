import fs from "fs-extra";
import path from "node:path";
import { createLlm } from "../io/llm/factory.js";
import { ROOT } from "../io/core.js";
import { AgentLogger as Logger } from "../io/utils/logger.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { validateScriptContent } from "../domain/validation.js";

async function main() {
  Logger.init();
  const runDirs = fs
    .readdirSync(path.join(ROOT, "runs"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const tasksPath = runDirs
    .map((dir) => path.join(ROOT, "runs", dir, "expansion_tasks.json"))
    .find((candidate) => fs.existsSync(candidate));

  if (!tasksPath) {
    Logger.error("HARNESS", "EXPANSION", "INIT_FAIL", "expansion_tasks.json not found in any dated runs directory");
    return;
  }

  const taskList = await fs.readJson(tasksPath);
  const llm = createLlm({ temperature: 0.5 });

  for (const task of taskList.tasks) {
    if (task.status === "completed" && task.current_chars >= taskList.target_chars) continue;

    const scriptPath = path.join(ROOT, task.path);
    if (!fs.existsSync(scriptPath)) continue;

    const script = await fs.readFile(scriptPath, "utf-8");
    Logger.info("HARNESS", "EXPANSION", "START", `Expanding ${task.project} (${task.current_chars} chars)`);

    const systemPrompt = "あなたはASMR台本の執筆者です。指定された文字数（最低5000文字）を確実に超えるように拡張してください。曖昧な指示ではなく、物理的な文字数を稼ぐために詳細な情景描写と内面描写を執筆してください。絶対にファイル名、パス、技術的な指示（例: ffmpeg）などのメタデータを出力に含めないでください。";
    const userPrompt = `現在の台本（${task.current_chars}文字）を拡張し、${taskList.target_chars}文字以上にしてください。全文を出力してください。\n\n${script}`;

    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ]);

      const expandedScript = response.content?.toString();
      if (!expandedScript || expandedScript.length < script.length) {
        throw new Error("Invalid or empty response from LLM");
      }

      const validationResult = validateScriptContent(expandedScript);
      if (!validationResult.success) {
        Logger.error("HARNESS", "EXPANSION", "VALIDATION_FAIL", `Validation failed for ${task.project}: ${validationResult.error}`);
        throw new Error(`Validation failed: ${validationResult.error}`);
      }

      const newCharCount = expandedScript.length;
      Logger.info("HARNESS", "EXPANSION", "RESULT", `${task.project} -> ${newCharCount} chars`);

      await fs.writeFile(scriptPath, expandedScript);
      task.current_chars = newCharCount;
      task.status = newCharCount >= taskList.target_chars ? "completed" : "pending_retry";
    } catch (err) {
      Logger.error("HARNESS", "EXPANSION", "TASK_FAIL", `Failed to expand ${task.project}: ${err}`);
      task.status = "failed_error";
    }
    await fs.writeJson(tasksPath, taskList, { spaces: 2 });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
