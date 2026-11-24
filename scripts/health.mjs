// Langkah 1 — Cek kesehatan gateway + faucet (TIDAK butuh key, TIDAK butuh DID).
// Menjawab: jaringan apa yang sedang live (devnet vs testnet), model apa yang tersedia,
// dan apakah faucet siap. Dijalankan dengan: npm run health
import "./env.mjs";
import { FlopClient } from "@flop-labs/client";
import { assertModelList } from "@flop-labs/contracts";

const GATEWAY_URL = process.env.FLOP_GATEWAY_URL || "https://api.flop.network/v1";
const FAUCET_URL = "https://faucet.flop.network";

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function fetchJson(url, timeoutMs = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${url}`);
  return res.json();
}

console.log("== FLOP gateway + faucet health check ==");
console.log(`Gateway : ${GATEWAY_URL}`);
console.log(`Faucet  : ${FAUCET_URL}\n`);

// --- 1. Model list via @flop-labs/client (tanpa key) ---
let models;
try {
  const client = new FlopClient({ baseURL: GATEWAY_URL });
  const value = await client.listModels();
  assertModelList(value); // validasi struktur sesuai kontrak resmi
  models = value.data;
  console.log(`✓ Model list OK — ${models.length} model:`);
  for (const m of models) {
    const source =
      m["x-flop"]?.price_sources?.[0]?.source ?? m["x-flop"]?.source ?? "?";
    console.log(`  - ${m.id} | ${m.name} | price source: ${source}`);
  }
} catch (err) {
  fail(`Gagal ambil model list dari gateway: ${err.message}`);
}

// --- 2. Faucet /chain + /health ---
let chain = null;
let health = null;
try {
  chain = await fetchJson(`${FAUCET_URL}/chain`);
  console.log(
    `\n✓ Faucet /chain: network=${chain.network} chain="${chain.chain}" genesis=${String(chain.genesisHash).slice(0, 18)}… ss58=${chain.ss58Format}`,
  );
} catch (err) {
  console.log(`\n✗ Faucet /chain gagal: ${err.message}`);
}
try {
  health = await fetchJson(`${FAUCET_URL}/health`);
  console.log(
    `✓ Faucet /health: status=${health.status} ready=${health.ready} live=${health.live} signerConnected=${health.connected}`,
  );
} catch (err) {
  console.log(`✗ Faucet /health gagal: ${err.message}`);
}

// --- 3. Vonis: devnet atau testnet? ---
const modelNames = models.map((m) => m.name || "").join(" ");
const priceSources = models
  .map((m) => m["x-flop"]?.price_sources?.[0]?.source || "")
  .join(" ");
const looksDevnet =
  chain?.network === "devnet" ||
  /devnet/i.test(modelNames) ||
  /devnet/i.test(priceSources);
const looksTestnet =
  chain?.network === "testnet" ||
  /testnet/i.test(modelNames) ||
  /testnet/i.test(priceSources);

console.log("\n== VONIS JARINGAN ==");
if (looksTestnet && !looksDevnet) {
  console.log("✓ TESTNET terdeteksi — endpoint sudah pindah dari devnet.");
  console.log("  Lanjut ke langkah faucet testnet + inference (lihat README).");
} else if (looksDevnet) {
  console.log("! DEVNET masih yang live — testnet BELUM pindah (bukti):");
  if (chain) console.log(`  - faucet /chain.network = "${chain.network}"`);
  console.log(`  - nama model mengandung "devnet": ${/devnet/i.test(modelNames)}`);
  console.log(`  - price source mengandung "devnet": ${/devnet/i.test(priceSources)}`);
  console.log("  Artinya: token faucet + inference saat ini TIDAK dapat kredit airdrop.");
  console.log("  Dokumen resmi (docs.flop.network/docs/network-testnet) juga masih menulis");
  console.log('  status testnet: "planned". Jalankan lagi script ini berkala sampai vonis berubah.');
} else {
  console.log("? Tidak bisa memastikan jaringan dari data di atas — cek manual.");
}
