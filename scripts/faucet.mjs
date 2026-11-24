// Langkah 2 — Klaim test FLOP dari faucet resmi (butuh alamat SS58 di .env).
// Dijalankan dengan: npm run faucet
// CATATAN: faucet hanya memberi dana, BUKAN kredit airdrop. Kredit airdrop hanya dari
// inference testnet yang sudah settle. Jangan ulangi request secara membabi-buta:
// kalau hasilnya "unknown", request itu mungkin sudah diproses — cek saldo dulu.
import "./env.mjs";
import { requestFaucetFunding, getFaucetChainInfo } from "@flop-labs/sdk";

const NETWORK = process.env.FLOP_NETWORK || "devnet";
const ADDRESS = process.env.FLOP_SS58_ADDRESS || "";
const AMOUNT = Number(process.env.FLOP_FAUCET_AMOUNT || 25);

if (!ADDRESS) {
  console.error("✗ BLOCKED — isi dulu FLOP_SS58_ADDRESS di .env (alamat SS58 wallet FLOP kamu).");
  console.error("  Alamat ini publik (bukan private key). Buat wallet di Polkadot.js / Talisman /");
  console.error("  SubWallet, atau pakai tombol 'Generate a test address' di faucet.flop.network.");
  process.exit(2);
}

console.log("== FLOP faucet claim ==");
console.log(`Jaringan : ${NETWORK}`);
console.log(`Alamat   : ${ADDRESS}`);
console.log(`Jumlah   : ${AMOUNT} FLOP (server bisa membatasi)\n`);

try {
  const info = await getFaucetChainInfo({ network: NETWORK });
  console.log(`✓ Faucet chain info: ${JSON.stringify(info)}`);
  if (info.network && info.network !== NETWORK) {
    console.log(
      `! PERINGATAN: faucet melayani jaringan "${info.network}", bukan "${NETWORK}". ` +
        `Token yang diterima kemungkinan BUKAN token ${NETWORK}.`,
    );
  }
} catch (err) {
  console.log(`! getFaucetChainInfo gagal (lanjut klaim): ${err.message}`);
}

const result = await requestFaucetFunding(ADDRESS, {
  network: NETWORK,
  amount: AMOUNT,
});

console.log("\n== Hasil ==");
console.log(JSON.stringify(result, null, 2));

if (result.success && result.outcome === "accepted") {
  console.log(`\n✓ Klaim diterima${result.amount ? ` — ${result.amount} FLOP` : ""}. Cek saldo dengan:`);
  console.log(`  npm run session   (atau: flop --network ${NETWORK} balance ${ADDRESS})`);
} else if (result.outcome === "unknown") {
  console.log("\n! Hasil TIDAK PASTI (unknown) — JANGAN ulangi request membabi-buta.");
  console.log("  Cek saldo dulu; request-nya mungkin sudah diproses.");
  process.exit(1);
} else {
  console.log(`\n✗ Klaim ditolak / tidak tersedia (outcome: ${result.outcome || "?"}, HTTP ${result.status || "?"}).`);
  if (result.retryAfterSeconds) {
    console.log(`  Cooldown server: ${result.retryAfterSeconds} detik. Coba lagi nanti.`);
  }
  console.log("  Alasan umum: cooldown 24 jam per alamat, atau faucet sedang tidak siap (cek npm run health).");
  process.exit(1);
}
