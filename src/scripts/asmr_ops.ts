import fs from "fs-extra";
import path from "node:path";
import { ROOT } from "../io/core.js";
import { AgentLogger as Logger } from "../io/utils/logger.js";

const ARCHIVE_ROOT = path.join(ROOT, "asmr/yawa-archive");
const AUDITION_ROOT = path.join(ROOT, "asmr/audition");
const RUNS_ROOT = path.join(ROOT, "runs");
const INVENTORY_PATH = path.join(ROOT, "asmr/INVENTORY.md");

const BRAND_MAPPING: Record<string, string> = {
  "tsukari": "tsukari-ryokan",
  "shinya": "shinya-kansokushitsu",
  "amaoto": "amaoto-shelter",
  "aitetsu": "aitetsu-library",
  "yoiyami": "yoiyami-lounge",
  "midnight": "midnight-call",
  "echo": "echo-memory",
  "oneesan": "oneesan",
  "maid": "r18-content",
  "r18": "r18-content",
  "yandere": "r18-content",
};

async function archiveProjects() {
  const runDirs = await fs.readdir(RUNS_ROOT);
  for (const dateDir of runDirs) {
    const fullDatePath = path.join(RUNS_ROOT, dateDir);
    if (!(await fs.stat(fullDatePath)).isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;

    const projects = await fs.readdir(fullDatePath);
    for (const project of projects) {
      const projectPath = path.join(fullDatePath, project);
      if (!(await fs.stat(projectPath)).isDirectory()) continue;

      const videoPath = path.join(projectPath, "final_video.mp4");
      if (!(await fs.exists(videoPath))) continue;

      // Identify brand
      let brand = "misc";
      for (const [key, value] of Object.entries(BRAND_MAPPING)) {
        if (project.toLowerCase().includes(key)) {
          brand = value;
          break;
        }
      }

      const targetDir = path.join(ARCHIVE_ROOT, brand, "runs", dateDir);
      await fs.ensureDir(targetDir);
      
      const dest = path.join(targetDir, project);
      if (!(await fs.exists(dest))) {
        Logger.info("ASMR_OPS", "ARCHIVE", "MOVE", `${project} -> ${brand}`);
        await fs.move(projectPath, dest);
      }
    }
  }
}

async function updateAuditionLinks() {
  const audioTarget = path.join(AUDITION_ROOT, "audio");
  const videoTarget = path.join(AUDITION_ROOT, "video");
  await fs.ensureDir(audioTarget);
  await fs.ensureDir(videoTarget);

  const brands = await fs.readdir(ARCHIVE_ROOT);
  for (const brand of brands) {
    const brandPath = path.join(ARCHIVE_ROOT, brand);
    if (!(await fs.stat(brandPath)).isDirectory()) continue;
    
    const runsPath = path.join(brandPath, "runs");
    if (!(await fs.exists(runsPath))) continue;

    const dates = (await fs.readdir(runsPath)).sort().reverse();
    for (const date of dates) {
      const datePath = path.join(runsPath, date);
      const projects = await fs.readdir(datePath);
      for (const project of projects) {
        const projectPath = path.join(datePath, project);
        const wav = path.join(projectPath, "final_mix.wav");
        const mp4 = path.join(projectPath, "final_video.mp4");

        if (await fs.exists(wav)) {
          const linkName = path.join(audioTarget, `${project}.wav`);
          await fs.remove(linkName);
          await fs.symlink(wav, linkName);
        }
        if (await fs.exists(mp4)) {
          const linkName = path.join(videoTarget, `${project}.mp4`);
          await fs.remove(linkName);
          await fs.symlink(mp4, linkName);
        }
      }
    }
  }
}

async function generateInventory() {
  const audioTarget = path.join(AUDITION_ROOT, "audio");
  if (!(await fs.exists(audioTarget))) return;

  const files = (await fs.readdir(audioTarget)).filter(f => f.endsWith(".wav"));
  
  let md = "# 🎧 ASMR 聴き比べ & 音声オーディション会場 (Audition Room) ✨\n\n";
  md += "マスター、お疲れ様！全自動ハーネスが整理した最新のラインナップだよ！💕\n\n";
  md += `最終更新: ${new Date().toLocaleString()}\n\n`;
  md += "### 📂 [エクスプローラーで開く](file://" + audioTarget + ")\n\n";
  md += "| プロジェクト | 音声ファイル | 動画 (MP4) |\n";
  md += "| :--- | :--- | :--- |\n";

  for (const file of files) {
    const projectName = file.replace(".wav", "");
    const videoFile = projectName + ".mp4";
    const videoExists = await fs.exists(path.join(AUDITION_ROOT, "video", videoFile));
    
    md += `| **${projectName}** | [👂 聴く](file://${path.join(audioTarget, file)}) | ${videoExists ? `[📺 観る](file://${path.join(AUDITION_ROOT, "video", videoFile)})` : "-"} |\n`;
  }

  md += "\n---\nマスターの「お気に入り」が見つかったら教えてね！o(≧▽≦)o\n";
  
  await fs.writeFile(INVENTORY_PATH, md);
  Logger.info("ASMR_OPS", "INVENTORY", "UPDATE", "Inventory regenerated");
}

async function main() {
  Logger.init();
  Logger.info("ASMR_OPS", "START", "RUN", "Starting ASMR Operations");
  
  await archiveProjects();
  await updateAuditionLinks();
  await generateInventory();
  
  Logger.info("ASMR_OPS", "FINISH", "SUCCESS", "ASMR Operations completed");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
