// Klaim faucet TESTNET untuk agent wallet — signed agent claim (D10).
// Format resmi: https://flop.network/llms.txt ("Get Testnet FLOP"):
//   sign UTF-8 `flop-faucet-agent/v1|<genesis>|<address>|<nonce>` dengan key wallet
//   penerima, lalu POST /v1/testnet/agent-claims {address, nonce, signature}.
// 10 FLOP per wallet per rolling 24 jam. TIDAK PERNAH mencetak password,
// seed, mnemonic, atau signature ke stdout — hanya alamat, nonce, dan hasil.
// Nonce dipakai ulang kalau retry (idempotent: nonce sama = tx sama).
import "./env.mjs";
import { readFileSync } from "node:fs";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, signatureVerify } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";

const FAUCET = "https://faucet.flop.network";
const GENESIS = "0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800";
const ADDRESS = process.env.FLOP_SS58_ADDRESS || "5ED8HdywXTDCQ3PgtA1pkqUJuivbbbhVCAf3YKRLnGuCkNYA";
const KEYSTORE = process.env.FLOP_KEYSTORE_PATH || "";
const PASSWORD_ENV = process.env.FLOP_KEY_PASSWORD_ENV || "FLOP_KEY_PASSWORD";
const NONCE = process.argv[2] || String(Date.now());

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

console.log("== Klaim faucet testnet (signed agent claim) ==");
console.log(`Alamat : ${ADDRESS}`);
console.log(`Nonce  : ${NONCE}`);

// 1. Cek identitas faucet.
const chain = await (await fetch(`${FAUCET}/chain`, { signal: AbortSignal.timeout(20000) })).json();
if (chain.network !== "testnet" || chain.genesisHash?.toLowerCase() !== GENESIS) {
  fail(`identitas faucet tidak cocok: network=${chain.network} genesis=${chain.genesisHash}`);
}
console.log("✓ Faucet chain: testnet, genesis D10 cocok");

// 2. Cek status + claim path.
const limits = await (await fetch(`${FAUCET}/limits`, { signal: AbortSignal.timeout(20000) })).json();
if (limits.faucet?.status !== "open" || limits.faucet?.agent?.claimPath !== "/v1/testnet/agent-claims") {
  fail(`faucet belum melayani agent claim: status=${limits.faucet?.status} claimPath=${limits.faucet?.agent?.claimPath}`);
}
console.log(`✓ Faucet open, signer ${limits.faucet.balanceFlop} FLOP, agent grant ${limits.faucet.agent.grantFlop} FLOP/24j`);

// 3. Buka keystore, pastikan alamatnya cocok.
if (!KEYSTORE) fail("FLOP_KEYSTORE_PATH kosong di .env");
if (!process.env[PASSWORD_ENV]) fail(`env var ${PASSWORD_ENV} kosong`);
await cryptoWaitReady();
const keyring = new Keyring({ type: "sr25519" });
let pair;
try {
  pair = keyring.addFromJson(JSON.parse(readFileSync(KEYSTORE, "utf8")), process.env[PASSWORD_ENV]);
} catch (err) {
  fail(`gagal membuka keystore: ${err.message}`);
}
if (pair.address !== ADDRESS) fail(`keystore membuka alamat lain: ${pair.address} (bukan ${ADDRESS})`);
if (pair.isLocked) pair.unlock(process.env[PASSWORD_ENV]);
console.log(`✓ Keystore dibuka — owner: ${pair.address}`);

// 4. Tanda tangani pesan klaim.
const message = `flop-faucet-agent/v1|${GENESIS}|${ADDRESS}|${NONCE}`;
const signature = pair.sign(new TextEncoder().encode(message));
const { isValid } = signatureVerify(message, signature, pair.publicKey);
if (!isValid) fail("verifikasi signature lokal gagal — batal sebelum kirim");
console.log("✓ Pesan klaim ditandatangani + terverifikasi lokal");

// 5. Kirim klaim (signature tidak pernah dicetak).
const res = await fetch(`${FAUCET}/v1/testnet/agent-claims`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: ADDRESS, nonce: NONCE, signature: u8aToHex(signature) }),
  signal: AbortSignal.timeout(60000),
});
const data = await res.json().catch(() => ({}));
console.log("\n== Hasil ==");
console.log(JSON.stringify({ http: res.status, success: data.success ?? null, amount: data.amount ?? null, txHash: data.txHash ?? null, status: data.status ?? null, error: data.error ?? null, reason: data.reason ?? null, retryAfterSeconds: data.retryAfterSeconds ?? null }, null, 2));
if (!res.ok || data.success !== true) {
  console.error("\n✗ Klaim belum berhasil — JANGAN retry buta; pakai nonce yang sama untuk cek ulang.");
  process.exit(2);
}
console.log(`\n✓ Klaim diterima — txHash: ${data.txHash}`);
console.log("  Grant baru bisa dibelanjakan setelah tx masuk blok final testnet.");
