import "dotenv/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import path from "path";
import fs from "fs-extra";

const ROOT = process.cwd();
const envPath = path.join(ROOT, "config", ".env");
if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, "utf-8");
    env.split("\n").forEach(line => {
        const [key, value] = line.split("=");
        if (key && value) process.env[key.trim()] = value.trim();
    });
}

async function testSearch() {
    const llm = new ChatGoogleGenerativeAI({
        model: "gemini-3-flash-preview",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0,
    }).bindTools([{ googleSearchRetrieval: {} }]);

    console.log("Testing search for 'Current price of NVDA stocks'...");
    const res = await llm.invoke("What is the current price of NVDA stocks and when was this data published?");
    console.log("Response Content:", res.content);
    console.log("Usage metadata:", JSON.stringify(res.response_metadata, null, 2));
}

testSearch().catch(console.error);
