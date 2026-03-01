import axios from "axios";
import fs from "fs-extra";
import path from "node:path";

const ttsUrl = "http://localhost:50121";
const speakerId = 8; // 春日部つむぎ
const text = "ええ、その通りです。例えば、BlackRockとMicrosoftが主導する「Global AI Infrastructure Investment Partnership (GAIIP)」は、2026年第1四半期に新たな資金調達ラウンドを完了します。";

async function test() {
  try {
    console.log("Generating audio_query...");
    const q = await axios.post(`${ttsUrl}/audio_query`, null, {
      params: { text, speaker: speakerId },
    });
    console.log("Generating synthesis...");
    const s = await axios.post(`${ttsUrl}/synthesis`, q.data, {
      params: { speaker: speakerId },
      responseType: "arraybuffer",
    });
    console.log("Writing to file...");
    fs.writeFileSync("test_audio.wav", Buffer.from(s.data));
    console.log("Success!");
  } catch (e) {
    console.error("Error:", e.message);
    if (e.response) {
      console.error("Status:", e.response.status);
      console.error("Data:", e.response.data.toString());
    }
  }
}

test();
