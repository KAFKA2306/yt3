import { sendAlert } from "../src/utils/discord.js";
import "dotenv/config";

(async () => {
    console.log("Testing Discord Alert...");
    await sendAlert("Test Alert from Production Hardening (Script)", "info");
    console.log("Alert sent (check Discord).");
})();
