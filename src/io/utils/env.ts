import * as dotenv from "dotenv";
import fs from "fs-extra";

export function loadEnvFile(filePath: string): void {
	if (!fs.existsSync(filePath)) return;
	for (const [key, value] of Object.entries(
		dotenv.parse(fs.readFileSync(filePath)),
	)) {
		if (value !== "") process.env[key] = value;
	}
}
