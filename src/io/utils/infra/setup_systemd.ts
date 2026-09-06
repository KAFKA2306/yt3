import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
const SYSTEMD_USER_DIR = path.join(os.homedir(), ".config/systemd/user");
const UNITS = [
	{ file: "yt3-automation.service", enable: false },
	{ file: "yt3-automation.timer", enable: true },
	{ file: "yt3-aim.service", enable: true },
	{ file: "yt3-discord.service", enable: true },
];
async function main() {
	fs.ensureDirSync(SYSTEMD_USER_DIR);
	const sourceDir = path.join(process.cwd(), "systemd");
	for (const unit of UNITS) {
		fs.copySync(
			path.join(sourceDir, unit.file),
			path.join(SYSTEMD_USER_DIR, unit.file),
		);
	}
	spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
	for (const unit of UNITS.filter((u) => u.enable)) {
		spawnSync("systemctl", ["--user", "enable", "--now", unit.file], {
			stdio: "inherit",
		});
	}
	console.log("✅ Setup Complete!");
	console.log(
		"\n⚠️  NOTE: Ensure 'loginctl enable-linger <user>' is run if you want this to run when not logged in.",
	);
}
main().catch(console.error);
