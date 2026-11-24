// Langkah 3 — Enroll wallet ke gateway publik untuk mendapat API key (allowance).
// Dijalankan dengan: npm run enroll
// CARA KERJA (dari dokumen resmi): gateway allowance adalah dana broker gateway,
// BUKAN token di wallet kamu. Faucet funds dan gateway allowance itu TERPISAH —
// mendanai wallet TIDAK otomatis memberi slot enroll. Enroll memakai tanda tangan
// wallet (wallet-signed). Allowance punya sisa kuota + masa berlaku (maks 24 jam).
// Issuance punya CAP bersama (rolling 24 jam, dibagi semua pendaftar): kalau penuh,
// error `wallet_enrollment_cap_reached` — coba lagi nanti dengan wallet YANG SAMA.
//
// Script ini TIDAK PERNAH mencetak bearer token / API key ke layar.
// Ia menjalankan CLI resmi `flop agent credential --json` (metadata non-secret saja)
// dan menyensor field apa pun yang berbau token sebelum ditampilkan.
// Key-nya tetap disimpan oleh CLI; salin sendiri ke .env sebagai FLOP_API_KEY
// kalau perlu — jangan pernah commit atau kirim key itu ke siapa pun.
import "./env.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NETWORK = process.env.FLOP_NETWORK || "devnet";
const KEYSTORE = process.env.FLOP_KEYSTORE_PATH || "";
const PASSWORD_ENV = process.env.FLOP_KEY_PASSWORD_ENV || "FLOP_KEY_PASSWORD";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flopCli = join(root, "node_modules", "@flop-labs", "cli", "dist", "cli.js");

function blocked(message) {
  console.error(`\n✗ BLOCKED — ${message}`);
  process.exit(2);
}

console.log("== FLOP gateway enrollment (API key) ==");
console.log(`Jaringan : ${NETWORK}\n`);

if (!KEYSTORE) {
  blocked(
    "enroll butuh keystore wallet (tanda tangan wallet wajib).\n" +
      "  1. Buat keystore baru (wallet KHUSUS devnet/testnet, BUKAN wallet dana asli,\n" +
      "     BUKAN identity.pem DID Technocore). Pakai CLI resmi:\n" +
      "       export FLOP_KEY_PASSWORD='...'\n" +
      "       flop keys generate --type sr25519 --out ./agent-keystore.json \\\n" +
      "         --password-env FLOP_KEY_PASSWORD\n" +
      "     (sr25519 = tipe untuk agen; JANGAN pakai --show-secret)\n" +
      "  2. Isi di .env:\n" +
      "       FLOP_KEYSTORE_PATH=/path/ke/agent.json\n" +
      "       FLOP_KEY_PASSWORD_ENV=FLOP_KEY_PASSWORD\n" +
      "     lalu isi password keystore itu di shell (jangan tulis di file):\n" +
      "       export FLOP_KEY_PASSWORD='...'\n" +
      "  3. Jalankan lagi: npm run enroll\n" +
      "  Atau jalankan langsung (tanpa script ini):\n" +
      `       flop --network ${NETWORK} --keystore <path> --password-env ${PASSWORD_ENV} agent credential --json`,
  );
}
if (!existsSync(KEYSTORE)) {
  blocked(`file keystore tidak ditemukan: ${KEYSTORE}`);
}
if (!process.env[PASSWORD_ENV]) {
  blocked(
    `env var ${PASSWORD_ENV} kosong — isi password keystore di shell (jangan tulis di file):\n` +
      `  export ${PASSWORD_ENV}='...'`,
  );
}

console.log("Menjalankan CLI resmi: flop agent credential --json ...");
console.log("(Output disensor: field token/key tidak akan ditampilkan.)\n");

const res = spawnSync(
  process.execPath,
  [
    flopCli,
    "--network",
    NETWORK,
    "--keystore",
    KEYSTORE,
    "--password-env",
    PASSWORD_ENV,
    "agent",
    "credential",
    "--json",
  ],
  { encoding: "utf8", timeout: 120000 },
);

const rawOut = (res.stdout || "") + (res.stderr || "");

if (res.error) {
  console.error(`✗ Gagal menjalankan CLI: ${res.error.message}`);
  process.exit(1);
}

// Sensor agresif: apa pun yang berbau token tidak boleh tampil.
function redact(text) {
  return text.replace(
    /("(?:bearer|token|api[_-]?key|secret|authorization)"\s*:\s*")[^"]*(")/gi,
    "$1[REDACTED]$2",
  );
}

let parsed = null;
try {
  parsed = JSON.parse(res.stdout.trim());
} catch {
  // bukan JSON murni — tampilkan apa adanya (sudah disensor)
}

if (parsed) {
  console.log(JSON.stringify(parsed, (k, v) =>
    /token|bearer|api[_-]?key|secret|authorization/i.test(k) ? "[REDACTED]" : v,
    2,
  ));
} else {
  console.log(redact(rawOut).slice(0, 3000));
}

if (/wallet_enrollment_cap_reached/i.test(rawOut)) {
  console.log(
    "\n! CAP ENROLLMENT PENUH (rolling 24 jam, dibagi semua pendaftar). " +
      "Coba lagi nanti dengan wallet YANG SAMA + challenge baru. " +
      "Jangan buat wallet baru untuk mengakali cap.",
  );
  process.exit(1);
}
if (/wallet_enrollment_unavailable/i.test(rawOut)) {
  console.log("\n! Enrollment sedang tidak tersedia (service failure di sisi gateway). Coba lagi nanti.");
  process.exit(1);
}
if (res.status !== 0) {
  console.log(`\n✗ CLI keluar dengan kode ${res.status}. Lihat output di atas.`);
  process.exit(1);
}

console.log(
  "\n✓ Enrollment selesai (metadata di atas). Kalau CLI menyimpan key, salin bearer token " +
    "itu ke .env sebagai FLOP_API_KEY — jangan pernah mencetak / commit / membagikannya. " +
    "Cek sisa kuota dengan GET /v1/keys/me (lihat README).",
);
