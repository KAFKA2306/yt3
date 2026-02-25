import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
const SYSTEMD_USER_DIR = path.join(os.homedir(), ".config/systemd/user");
const SERVICE_FILE = "yt3-workflow.service";
const TIMER_FILE = "yt3-workflow.timer";
async function main() {
	console.log("🚀 Setting up Systemd for Youtuber Workflow...");
	fs.ensureDirSync(SYSTEMD_USER_DIR);
	const sourceDir = path.join(process.cwd(), "systemd");
	console.log(`📂 Copying unit files to ${SYSTEMD_USER_DIR}...`);
	fs.copySync(
		path.join(sourceDir, SERVICE_FILE),
		path.join(SYSTEMD_USER_DIR, SERVICE_FILE),
	);
	fs.copySync(
		path.join(sourceDir, TIMER_FILE),
		path.join(SYSTEMD_USER_DIR, TIMER_FILE),
	);
	console.log("🔄 Reloading systemd daemon...");
	spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
	console.log("⏰ Enabling and starting timer...");
	spawnSync("systemctl", ["--user", "enable", TIMER_FILE], {
		stdio: "inherit",
	});
	spawnSync("systemctl", ["--user", "start", TIMER_FILE], { stdio: "inherit" });
	console.log("✅ Setup Complete! Status:");
	spawnSync("systemctl", ["--user", "status", TIMER_FILE], {
		stdio: "inherit",
	});
	console.log(
		"\n⚠️  NOTE: Ensure 'loginctl enable-linger <user>' is run if you want this to run when not logged in.",
	);
}
main().catch(console.error);
