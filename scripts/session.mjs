// Langkah 5 — Direct session ke miner bernama via SDK (on-chain, pakai escrow).
// Dijalankan dengan: npm run session
//
// ALUR (dokumen resmi "Send a request to a specific miner"):
//   request (5 field) -> miner menerima -> miner kirim proof -> settle (bayar).
// Script ini berjalan 2 fase:
//   FASE 1 (read-only, selalu jalan): konek RPC, cek health node, cek saldo alamat.
//   FASE 2 (butuh keystore): buat agent wallet + session key TURUNAN (derived key
//     dengan spend cap + expiry — owner key TIDAK PERNAH diberikan ke agen), danai,
//     lalu runDirectSession ke miner bernama. Receipt diverifikasi SDK sebelum bayar.
//
// ATURAN KERAS script ini:
//   - TIDAK PERNAH membuat/membaca identity.pem DID Technocore. DID itu urusan Alex.
//   - TIDAK PERNAH memakai seed phrase. Signer hanya dari keystore JSON terenkripsi
//     (FLOP_KEYSTORE_PATH + password dari env). Tanpa keystore, fase 2 berhenti.
//   - Delegate key (session key) dibuat segar di memori proses saja, tidak pernah
//     ditulis ke disk / dicetak. Intent pemulihan channel disimpan di state/ (gitignored,
//     mode 0600) — itu material privat, jangan dibagikan.
//   - Jaringan mainnet DITOLAK. Repo ini devnet/testnet saja.
//   - Semua input fase 2 divalidasi SEBELUM ada transaksi yang ditandatangani.
import "./env.mjs";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, randomAsU8a } from "@polkadot/util-crypto";
import {
  FlopClient,
  createAgentWallet,
  fundAgentWallet,
  createCalibratedSession,
  runDirectSession,
} from "@flop-labs/sdk";

const NETWORK = process.env.FLOP_NETWORK || "devnet";
const RPC_URL =
  process.env.FLOP_RPC_URL ||
  (NETWORK === "testnet"
    ? "wss://testnet.flop.network"
    : "wss://rpc.devnet.flop.network");
const AGENT_ADDRESS = process.env.FLOP_SS58_ADDRESS || "";
const KEYSTORE = process.env.FLOP_KEYSTORE_PATH || "";
const PASSWORD_ENV = process.env.FLOP_KEY_PASSWORD_ENV || "FLOP_KEY_PASSWORD";
const MINER = process.env.FLOP_MINER_ADDRESS || "";
const MINER_ENDPOINT = process.env.FLOP_MINER_ENDPOINT || "";
const MODEL = process.env.FLOP_MODEL || "qwen/qwen2.5-0.5b-instruct";
const PROMPT = process.env.FLOP_PROMPT || "Say hello.";
const MAX_FLOP = Number(process.env.FLOP_MAX_FLOP || 0.01);
const DAILY_CAP = Number(process.env.FLOP_SESSION_DAILY_CAP || 50);
const PER_TX = Number(process.env.FLOP_SESSION_PER_TX || 5);
const EXPIRY_HOURS = Number(process.env.FLOP_SESSION_EXPIRY_HOURS || 24);
const FUND_AMOUNT = Number(process.env.FLOP_FUND_AMOUNT || 1);
const INDEXER_URL =
  process.env.FLOP_INDEXER_URL ||
  (NETWORK === "devnet" ? "https://explorer.devnet.flop.network" : undefined);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1 FLOP = 10^18 planck. Parse string desimal secara eksak (tanpa float).
function parseFlop(str) {
  const [whole = "0", frac = ""] = String(str).split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
}

function blocked(message) {
  console.error(`\n✗ BLOCKED — ${message}`);
  process.exit(2);
}

console.log("== FLOP direct session (SDK) ==");
console.log(`Jaringan : ${NETWORK}`);
console.log(`RPC      : ${RPC_URL}`);
console.log(`Model    : ${MODEL}`);
console.log(`Max escrow: ${MAX_FLOP} FLOP\n`);

if (NETWORK === "mainnet") {
  console.error("✗ DITOLAK: repo ini devnet/testnet saja. Jangan jalankan ke mainnet.");
  process.exit(1);
}

// ---------- FASE 1: read-only ----------
console.log("-- Fase 1: cek read-only (tanpa key) --");
let api;
try {
  const provider = new WsProvider(RPC_URL, 1000, undefined, 20000);
  api = await Promise.race([
    ApiPromise.create({ provider }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout konek RPC 20 detik")), 20000),
    ),
  ]);
  await api.isReady;
} catch (err) {
  console.error(`\n✗ Tidak bisa konek ke RPC ${RPC_URL}: ${err.message}`);
  console.error("  Catatan: dari VM ini koneksi wss sering diblokir egress. Chain-nya sendiri");
  console.error("  hidup (faucet /health menunjukkan indexer mengikuti head). Cek HTTP:");
  console.error("    npm run health");
  console.error("  lalu jalankan session ini dari host yang bisa membuka wss://.");
  process.exit(1);
}

const readOnly = FlopClient.fromApiReadOnly(api);
try {
  const health = await readOnly.health();
  console.log(`✓ Node health: ${JSON.stringify(health)}`);
} catch (err) {
  console.log(`! health() gagal: ${err.message}`);
}
if (AGENT_ADDRESS) {
  try {
    const balance = await readOnly.getBalance(AGENT_ADDRESS);
    const info = await readOnly.getAccountInfo(AGENT_ADDRESS);
    console.log(`✓ Saldo ${AGENT_ADDRESS}: ${balance} FLOP (nonce ${info.nonce})`);
  } catch (err) {
    console.log(`! Cek saldo gagal: ${err.message}`);
  }
} else {
  console.log("! FLOP_SS58_ADDRESS kosong — saldo tidak dicek (isi di .env untuk cek).");
}

// ---------- FASE 2: signing (butuh keystore) ----------
console.log("\n-- Fase 2: signing (butuh keystore) --");
if (!KEYSTORE) {
  blocked(
    "fase signing butuh keystore (FLOP_KEYSTORE_PATH).\n" +
      "  Buat keystore baru khusus devnet/testnet:\n" +
      "    export FLOP_KEY_PASSWORD='...'\n" +
      "    flop keys generate --type sr25519 --out ./agent-keystore.json --password-env FLOP_KEY_PASSWORD\n" +
      "  Lalu danai wallet itu dari faucet (npm run faucet) dan isi di .env:\n" +
      "    FLOP_KEYSTORE_PATH=/path/ke/agent-keystore.json\n" +
      "  JANGAN pakai identity.pem DID / seed phrase / wallet dana asli.",
  );
}
if (!process.env[PASSWORD_ENV]) {
  blocked(`env var ${PASSWORD_ENV} kosong — isi password keystore di shell.`);
}
if (!MINER || !MINER_ENDPOINT) {
  blocked(
    "direct session butuh miner bernama + endpoint yang reachable.\n" +
      "  Isi di .env: FLOP_MINER_ADDRESS (SS58 miner) dan FLOP_MINER_ENDPOINT\n" +
      "  (contoh endpoint miner: http://127.0.0.1:8645 kalau miner jalan di host yang sama,\n" +
      "  atau endpoint HTTPS publik miner yang opted-in).\n" +
      "  Tanpa miner + endpoint, TIDAK ADA yang bisa di-sign — berhenti sebelum transaksi.",
  );
}

await cryptoWaitReady();
const keyring = new Keyring({ type: "sr25519" });
let ownerPair;
try {
  const keystoreJson = JSON.parse(readFileSync(KEYSTORE, "utf8"));
  ownerPair = keyring.addFromJson(keystoreJson, process.env[PASSWORD_ENV]);
} catch (err) {
  console.error(`\n✗ Gagal membuka keystore ${KEYSTORE}: ${err.message}`);
  console.error("  Pastikan path benar dan password di env sudah benar.");
  process.exit(1);
}
console.log(`✓ Keystore dibuka — owner: ${ownerPair.address} (alamat saja yang ditampilkan)`);

const client = await FlopClient.createWithKeypair(RPC_URL, ownerPair);
console.log(`✓ Terhubung sebagai ${client.address}`);

// Delegate key: dibuat segar di memori saja, TIDAK PERNAH ditulis/dicetak.
// Ini session key turunan dengan cap + expiry — owner key tidak pernah diberikan ke agen.
const delegatePair = keyring.addFromSeed(randomAsU8a(32));
console.log(`✓ Delegate key dibuat di memori (alamat: ${delegatePair.address}) — tidak disimpan di disk`);

const dailyCapRaw = parseFlop(String(DAILY_CAP));
const perTxRaw = parseFlop(String(PER_TX));
const spendingCapRaw = dailyCapRaw * 10n; // lifetime cap default = 10x daily cap
const durationBlocks = Math.floor(EXPIRY_HOURS * 3600); // blok ~1 detik
const maxFlopRaw = parseFlop(String(MAX_FLOP));
const fundRaw = parseFlop(String(FUND_AMOUNT));

console.log(
  `\nBatas session key: dailyCap=${DAILY_CAP} FLOP, perTx=${PER_TX} FLOP, ` +
    `spendingCap=${DAILY_CAP * 10} FLOP, durasi=${EXPIRY_HOURS} jam (${durationBlocks} blok)`,
);

try {
  console.log("\n[1/4] createAgentWallet (owner mendaftarkan agent wallet)...");
  const walletTx = await createAgentWallet(client.api, client.signer, {
    agent: delegatePair.address,
    perTxLimit: perTxRaw,
    dailyCap: dailyCapRaw,
  });
  console.log(`✓ tx hash: ${walletTx}`);

  console.log(`\n[2/4] fundAgentWallet (+${FUND_AMOUNT} FLOP dari owner ke agent)...`);
  const fundTx = await fundAgentWallet(client.api, client.signer, delegatePair.address, fundRaw);
  console.log(`✓ tx hash: ${fundTx}`);

  console.log("\n[3/4] createCalibratedSession (session key turunan, cap + expiry)...");
  const sessionTx = await createCalibratedSession(client.api, client.signer, {
    delegate: delegatePair.address,
    spendingCap: spendingCapRaw,
    perTxLimit: perTxRaw,
    dailyCap: dailyCapRaw,
    durationBlocks,
  });
  console.log(`✓ tx hash: ${sessionTx}`);

  console.log(`\n[4/4] runDirectSession ke miner ${MINER} ...`);
  console.log(`  endpoint: ${MINER_ENDPOINT} | via: auto | maxFlop: ${MAX_FLOP} FLOP`);
  const stateDir = join(root, "state");
  mkdirSync(stateDir, { recursive: true });
  const result = await runDirectSession({
    api: client.api,
    signer: delegatePair,
    miner: MINER,
    model: MODEL,
    prompt: PROMPT,
    maxFlop: maxFlopRaw,
    maxTokens: 256,
    via: "auto",
    endpoint: MINER_ENDPOINT,
    indexerUrl: INDEXER_URL,
    onPrepared: async (intent) => {
      // Material pemulihan privat — simpan di file gitignored mode 0600, JANGAN dicetak.
      const file = join(stateDir, `session-intent-${intent.channelId}.json`);
      writeFileSync(file, JSON.stringify(intent, null, 2), { mode: 0o600 });
      chmodSync(file, 0o600);
      console.log(`  (intent pemulihan disimpan di ${file} — jangan dibagikan)`);
    },
    onVerified: (receipt, claim) => {
      console.log(
        `  ✓ Receipt terverifikasi: finishReason=${receipt?.finishReason} ` +
          `completionTokens=${receipt?.completionTokens}`,
      );
    },
  });

  console.log("\n✓ DIRECT SESSION SELESAI:");
  const reply = result?.reply ?? result?.text ?? result?.output ?? null;
  if (reply) console.log(`\n--- reply miner ---\n${reply}\n-----------------`);
  console.log("\nRingkasan hasil (dipotong 2000 karakter):");
  console.log(JSON.stringify(result, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 2000));
} catch (err) {
  console.error(`\n✗ Session gagal: ${err.name || "Error"} — ${err.message}`);
  if (err?.channelId) console.error(`  channelId: ${err.channelId} (cek state/ untuk intent pemulihan)`);
  console.error("  Kalau channel sudah terbuka tapi belum settle, pakai path pemulihan permissionless");
  console.error("  (expire_force_open / timeout / finalize) sesuai docs send-to-specific-miner.");
  process.exit(1);
} finally {
  await client.disconnect().catch(() => {});
  await api.disconnect().catch(() => {});
}
