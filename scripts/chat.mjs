// Langkah 4 — Chat completion pertama via gateway (@flop-labs/client).
// Dijalankan dengan: npm run chat
// Chat completion BUTUH API key (gateway allowance). Kalau key belum ada, script ini
// TIDAK mengarang sukses: ia mencoba satu panggilan tanpa key untuk menunjukkan
// error persis dari gateway, lalu berhenti dengan instruksi yang kurang.
import "./env.mjs";
import { randomUUID } from "node:crypto";
import { FlopClient } from "@flop-labs/client";

const GATEWAY_URL = process.env.FLOP_GATEWAY_URL || "https://api.flop.network/v1";
const API_KEY = process.env.FLOP_API_KEY || "";
const MODEL = process.env.FLOP_MODEL || "qwen/qwen2.5-0.5b-instruct";
const PROMPT = process.env.FLOP_PROMPT || "Say hello.";

function blocked(message) {
  console.error(`\n✗ BLOCKED — ${message}`);
  process.exit(2);
}

console.log("== FLOP gateway chat completion ==");
console.log(`Gateway : ${GATEWAY_URL}`);
console.log(`Model   : ${MODEL}`);
console.log(`Prompt  : ${JSON.stringify(PROMPT)}`);
console.log(`API key : ${API_KEY ? "terisi (tidak ditampilkan)" : "KOSONG"}\n`);

const client = new FlopClient({ baseURL: GATEWAY_URL, apiKey: API_KEY || undefined });

if (!API_KEY) {
  console.log("Mencoba SATU panggilan tanpa key untuk melihat error persis gateway...");
  try {
    await client.createChatCompletion({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
    });
    console.log("! Tidak disangka: panggilan tanpa key BERHASIL (gateway mungkin sedang terbuka).");
  } catch (err) {
    console.log(`✓ Error persis (diharapkan tanpa key): ${err.name || "Error"} — ${err.message}`);
    if (err.status) console.log(`  HTTP status: ${err.status}`);
  }
  blocked(
    "chat completion butuh FLOP_API_KEY.\n" +
      "  Dapatkan lewat: npm run enroll\n" +
      "  (butuh keystore + tanda tangan wallet; lihat README langkah 3).\n" +
      "  Lalu isi FLOP_API_KEY di .env dan jalankan lagi: npm run chat\n" +
      "  Catatan: isi key itu allowance gateway broker (bukan token wallet kamu), " +
      "masa berlakunya maks 24 jam dan tidak bisa dipulihkan kalau kedaluwarsa.",
  );
}

const correlationId = `flop-agent-${randomUUID()}`;
console.log(`Correlation ID tugas: ${correlationId}\n`);

try {
  const task = client.task(correlationId);
  const res = await task.createChatCompletion({
    model: MODEL,
    messages: [{ role: "user", content: PROMPT }],
  });
  const text = res?.choices?.[0]?.message?.content;
  console.log("✓ Chat completion BERHASIL:");
  if (text) console.log(`\n--- reply ---\n${text}\n-------------`);
  console.log("\nRespons mentah (dipotong 2000 karakter):");
  console.log(JSON.stringify(res, null, 2).slice(0, 2000));
  if (res?.id) {
    try {
      const receipt = await client.getCredentialReceipt(res.id);
      console.log("\n✓ Credential receipt:");
      console.log(JSON.stringify(receipt, null, 2).slice(0, 1000));
    } catch (err) {
      console.log(`\n! getCredentialReceipt gagal: ${err.message}`);
    }
  }
} catch (err) {
  console.error(`\n✗ Chat completion gagal: ${err.name || "Error"} — ${err.message}`);
  if (err.status) console.error(`  HTTP status: ${err.status}`);
  if (err.status === 401 || /unauthorized|invalid.*key|expired/i.test(err.message)) {
    console.error("  Kemungkinan: key salah / kedaluwarsa / kuota habis. Enroll ulang: npm run enroll");
  }
  process.exit(1);
}
