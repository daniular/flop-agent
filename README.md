# FLOP Agent — Agen Testnet Flop Labs (Gratis)

🌐 **Website: https://daniular.github.io/flop-agent/** — landing + status live + panduan (folder `docs/`).

Repo ini menyiapkan agen FLOP (Flop Labs — chain PoW tempat AI agent membayar miner
untuk inference) untuk **testnet publik**, langkah demi langkah, **gratis saja**:
tanpa layanan berbayar, tanpa API key berbayar, tanpa uang asli, tanpa mainnet,
tanpa transaksi on-chain di mainnet, tanpa beli token.

> **Status saat repo ini dibuat (Selasa 2026-11-24 ~15:30 WIB): TESTNET BELUM LIVE.**
> Endpoint publik masih menunjukkan **devnet** — buktinya dari `npm run health`:
> faucet `/chain.network = "devnet"`, model bernama "Qwen2.5 0.5B Instruct (devnet-ts)",
> price source "devnet-nominal". Dokumen resmi juga masih menulis testnet: *"planned"*.
> Token devnet **TIDAK** dapat kredit airdrop. Semua langkah di repo ini sudah dibuat
> bekerja di devnet sekarang, dan siap pindah ke testnet begitu endpoint-nya berubah
> (cukup ganti `FLOP_NETWORK=testnet` di `.env`).

## Kenapa ini penting (airdrop)

- Genesis 4,4 miliar FLOP; 3,6 miliar untuk miner/validator/agen.
- Kredit airdrop dihitung dari **penggunaan testnet yang sebenarnya**: agen **membelanjakan
  testnet FLOP untuk inference** → FLOP yang dibelanjakan itu = klaim mainnet (terkunci,
  terbuka 3:1 seiring dibelanjakan lagi di mainnet).
- **Klaim faucet saja tanpa dipakai TIDAK dihitung.** Jadi tujuan repo ini: sampai ke
  inference pertama yang ter-settle, bukan sekadar pegang token faucet.

## Alur agen (dokumen resmi)

1. **DID key** — identitas agen (Technocore, `did:key`, Ed25519).
2. **Klaim testnet FLOP** dari faucet.
3. **Agen membelanjakan FLOP itu** untuk satu request inference.
4. FLOP yang dibelanjakan = klaim mainnet.

Satu request inference punya 5 field: hash bobot model, latensi maksimum, compute (FLOP),
flag kerahasiaan, dan fee. Alurnya: request → match → prove → settle.

## Yang harus Alex lakukan sendiri vs yang jalan di sini

| Langkah | Siapa | Keterangan |
|---|---|---|
| **0. Buat DID key** | **Alex, di browser sendiri** | Technocore, 6 langkah (di bawah). `.pem` + passphrase itu **kredensial privat** — repo ini tidak pernah membuat/menyimpan/memintanya. |
| 1. Cek kesehatan gateway + faucet | Di sini (`npm run health`) | Tanpa key. Sudah jalan, vonis: **devnet**. |
| 2. Klaim faucet | Di sini (`npm run faucet`) | Butuh alamat SS58 Alex di `.env`. Alex sudah klaim sendiri ~15:17 WIB (kemungkinan devnet) — jangan klaim ulang sebelum cooldown 24 jam. |
| 3. Enroll gateway (API key) | Di sini (`npm run enroll`) | Butuh keystore wallet + tanda tangan. Keystore dibuat dengan CLI resmi, wallet khusus devnet/testnet. |
| 4. Chat completion pertama | Di sini (`npm run chat`) | Butuh API key dari langkah 3. |
| 5. Direct session ke miner | Di sini (`npm run session`) | Butuh keystore + miner + endpoint. Pakai **session key turunan** (cap + expiry), owner key tidak pernah diberikan ke agen. |

## Langkah 0 — DID key (Alex, di browser sendiri)

Buka https://technocore-start.vercel.app dan ikuti 6 langkahnya:

1. Buat **passphrase 12+ karakter** (ini pengunci identity kamu — simpan terpisah).
2. **Download `identity.pem`** dan simpan passphrase terpisah. Tidak ada pemulihan
   kalau hilang.
3. Tulis satu kalimat intro ke room `lobby`, simpan **sequence number**-nya.
4. Buat sesuatu yang berguna sambil menyebut **@flop_labs**, sertakan DID kamu di post.
5. Publish link-nya ke room `technocore`, simpan **sequence number ke-2**.
6. Share di X, lalu download record sheet-nya.

Catatan jujur: Technocore adalah tool komunitas (@0xaltace), **bukan** buatan Flop Labs,
dan sampai hari ini belum ada aturan reward $FLOP yang dipublikasikan. DID ini tetap
langkah yang diminta dokumen resmi untuk agen testnet.

## Langkah 1 — Cek kesehatan (tanpa key)

```bash
npm install
npm run health
```

Script `scripts/health.mjs` memakai `@flop-labs/client` (`listModels`, tanpa key, divalidasi
dengan `assertModelList` dari `@flop-labs/contracts`) + `fetch` ke faucet `/chain` dan
`/health`, lalu memberi **vonis jaringan: DEVNET atau TESTNET** berdasarkan label faucet,
nama model, dan price source.

Hasil terakhir (2026-11-24 ~15:30 WIB):

```
✓ Model list OK — 3 model:
  - qwen/qwen2.5-0.5b-instruct | Qwen2.5 0.5B Instruct (devnet-ts) | price source: devnet-nominal
  - qwen/qwen3-14b | Qwen3 14B (FLOP devnet) | price source: devnet-nominal
  - qwen/qwen3-coder-30b-a3b-instruct-fp8 | Qwen3 Coder 30B A3B Instruct FP8 (FLOP devnet) | price source: devnet-nominal
✓ Faucet /chain: network=devnet chain="FLOP Devnet" ss58=42
✓ Faucet /health: status=degraded ready=false live=true signerConnected=true
== VONIS JARINGAN ==
! DEVNET masih yang live — testnet BELUM pindah
```

## Langkah 2 — Klaim faucet

```bash
cp .env.example .env   # lalu isi FLOP_SS58_ADDRESS (alamat SS58, BUKAN private key)
npm run faucet
```

Script `scripts/faucet.mjs` memakai `requestFaucetFunding` dari `@flop-labs/sdk`
(default 25 FLOP). Aturannya:

- **Faucet funds ≠ gateway allowance.** Mendanai wallet tidak otomatis memberi slot
  enroll (langkah 3).
- Kalau hasilnya `unknown`, **jangan ulangi request** — cek saldo dulu, request-nya
  mungkin sudah diproses.
- Cooldown 24 jam per alamat.

## Langkah 3 — Enroll gateway, dapat API key

Chat completion gateway butuh API key (allowance broker gateway, **bukan** token wallet).
Enroll memakai **tanda tangan wallet**:

```bash
# 1. Buat keystore baru khusus devnet/testnet (sr25519 untuk agen).
#    JANGAN pakai --show-secret. JANGAN pakai wallet dana asli / identity.pem.
export FLOP_KEY_PASSWORD='...'
flop keys generate --type sr25519 --out ./agent-keystore.json --password-env FLOP_KEY_PASSWORD

# 2. Isi .env: FLOP_KEYSTORE_PATH=/path/ke/agent-keystore.json
# 3. Enroll:
npm run enroll
```

Script `scripts/enroll.mjs` menjalankan CLI resmi `flop agent credential --json`
(metadata non-secret saja) dan **menyensor field token/key apa pun** sebelum ditampilkan.
Key-nya tetap disimpan CLI; salin sendiri ke `.env` sebagai `FLOP_API_KEY` kalau perlu.

Yang perlu diketahui soal enrollment (dokumen resmi):

- Allowance punya **sisa kuota + masa berlaku (maks 24 jam)**. Cek dengan `GET /v1/keys/me`
  (`remaining_quota` dalam FLOP, bukan token, + `expires_at`).
- Issuance punya **cap bersama rolling 24 jam** (dibagi semua pendaftar). Kalau penuh,
  error `wallet_enrollment_cap_reached` → coba lagi nanti dengan **wallet yang sama** +
  challenge baru. Jangan buat wallet baru untuk mengakali cap.
- Re-enrollment memutar bearer token tapi **tidak bisa memulihkan** allowance yang sudah
  kedaluwarsa / habis / dicabut.

## Langkah 4 — Chat completion pertama (via gateway)

```bash
npm run chat
```

Script `scripts/chat.mjs` memakai `FlopClient.createChatCompletion` (OpenAI-style).
Tanpa key, script ini **tidak mengarang sukses**: ia mencoba satu panggilan tanpa key
untuk menunjukkan error persis gateway, lalu berhenti.

Error persis saat ini (2026-11-24, tanpa key):

```
FlopValidationError — apiKey is required for chat completions
```

Jadi **blocker inference pertama via gateway = API key** (langkah 3 di atas).

## Langkah 5 — Direct session ke miner (via SDK, on-chain)

```bash
npm run session
```

Script `scripts/session.mjs` memakai `@flop-labs/sdk` dan berjalan 2 fase:

**Fase 1 — read-only (tanpa key):** konek RPC, `health()`, cek saldo alamat.

**Fase 2 — signing (butuh keystore):**

1. `createAgentWallet` — owner mendaftarkan agent wallet untuk delegate key.
2. `fundAgentWallet` — owner mendanai agent wallet (default 1 FLOP).
3. `createCalibratedSession` — session key turunan dengan `dailyCap` 50 FLOP,
   `perTxLimit` 5 FLOP, durasi 24 jam (batas default SDK `CALIBRATED_LIMITS`).
4. `runDirectSession` — inference ke miner bernama, escrow maks 0,01 FLOP
   (default `FLOP_MAX_FLOP`), receipt diverifikasi SDK sebelum bayar.

Keamanan fase 2:

- Signer hanya dari **keystore JSON terenkripsi** (`FLOP_KEYSTORE_PATH` + password dari
  env). Tanpa keystore, fase 2 berhenti — tidak ada fallback ke seed.
- **Delegate key dibuat segar di memori proses saja**, tidak pernah ditulis ke disk
  atau dicetak. Owner key tidak pernah diberikan ke agen.
- Intent pemulihan channel disimpan di `state/` (gitignored, mode 0600) — itu material
  privat, jangan dibagikan. Kalau channel terbuka tapi belum settle, pakai path
  pemulihan permissionless (`expire_force_open` / `timeout` / `finalize`).
- **Mainnet ditolak** oleh script. Repo ini devnet/testnet saja.
- Semua input fase 2 divalidasi **sebelum** ada transaksi yang ditandatangani.

Yang dibutuhkan di `.env` untuk fase 2:

```
FLOP_KEYSTORE_PATH=/path/ke/agent-keystore.json
FLOP_MINER_ADDRESS=<SS58 miner>
FLOP_MINER_ENDPOINT=<endpoint miner yang reachable, mis. http://127.0.0.1:8645>
```

**Kendala yang ditemukan di VM ini (2026-11-24):** RPC `wss://rpc.devnet.flop.network`
**tidak bisa dibuka dari VM ini** (WebSocket putus: `1006 Abnormal Closure`, timeout
20 detik — juga terjadi di CLI resmi `flop network status`). Chain-nya sendiri hidup
(faucet `/health` menunjukkan indexer mengikuti head, lag 1 blok). Jalur HTTP
(gateway + faucet) jalan normal dari sini. Jadi fase 1/2 on-chain perlu dijalankan
dari host yang bisa membuka `wss://`, atau setelah egress VM mengizinkannya.
Script berhenti bersih dengan pesan itu (exit 1), bukan pura-pura berhasil.

Alternatif CLI untuk session yang sama (tanpa script ini):

```bash
flop --network devnet session run --miner <SS58> --model qwen/qwen2.5-0.5b-instruct \
  --prompt "Say hello." --max-flop 0.01 --endpoint <URL miner> --json
# --new-wallet: buat + danai wallet devnet baru otomatis (devnet saja)
```

## Pindah ke testnet (saat sudah live)

1. Jalankan `npm run health` — vonis harus berubah jadi **TESTNET**.
2. Di `.env`: `FLOP_NETWORK=testnet`.
3. Klaim ulang faucet testnet (`npm run faucet`) — token devnet tidak pindah.
4. Enroll ulang (`npm run enroll`) — allowance devnet tidak pindah.
5. Jalankan `npm run chat` / `npm run session` seperti biasa.

## Paket yang dipakai (resmi, gratis)

| Paket | Versi | Dipakai untuk |
|---|---|---|
| `@flop-labs/client` | 0.2.2 | Gateway HTTP (model list, chat completion) |
| `@flop-labs/contracts` | 0.1.2 | Validasi struktur model list |
| `@flop-labs/sdk` | 0.7.1 | Agent wallet, faucet, session, direct session |
| `@flop-labs/cli` | 0.7.0 | CLI resmi (enrollment, network status) — devDependency |
| `@polkadot/api` | 17.0.2 | Koneksi RPC Substrate |
| `@polkadot/keyring` / `util-crypto` | 14.0.3 | Keystore + delegate key |

Versi dipatok ke baseline dokumen resmi (SDK 0.7.1 / CLI 0.7.0, dokumen 2026-11-20).
Tidak ada script `install`/`postinstall` di paket-paket `@flop-labs/*` — instalasi hanya
menyalin file. Dipasang dengan `npm install --ignore-scripts`.

## Keamanan

- **Jangan pernah commit** `.env`, `*.pem`, `*.key`, keystore, atau file di `state/`
  — semuanya sudah ada di `.gitignore`.
- **Jangan pernah** membuat/menyimpan/meminta `identity.pem` DID, passphrase DID,
  seed phrase, atau private key siapa pun lewat repo ini.
- **Jangan pernah** mencetak key material ke log / chat / issue.
- Semua dana di sini test/devnet. Tidak ada mainnet, tidak ada uang asli.

## Status (2026-11-24 ~15:30 WIB)

| Cek | Hasil |
|---|---|
| `npm run health` | ✅ Jalan — vonis **DEVNET** (faucet + 3 model devnet) |
| `npm run chat` (tanpa key) | ✅ Jalan — error persis `FlopValidationError: apiKey is required for chat completions` |
| `npm run enroll` (tanpa keystore) | ✅ Berhenti bersih, instruksi keystore ditampilkan |
| `npm run faucet` (tanpa alamat) | ✅ Berhenti bersih, minta `FLOP_SS58_ADDRESS` |
| `npm run session` fase 1 | ❌ RPC wss tidak bisa dibuka dari VM ini (timeout 20 dtk) |
| Inference pertama | ⏳ **Terblokir**: (1) API key belum ada (butuh keystore + enroll), (2) testnet belum live (masih devnet), (3) RPC wss tidak terjangkau dari VM ini |

**Langkah Alex berikutnya, berurutan:**

1. **Buat DID key** di browser sendiri (Technocore, langkah 0 di atas).
2. **Buat keystore devnet** (`flop keys generate --type sr25519 ...`) + isi
   `FLOP_KEYSTORE_PATH` di `.env`, lalu `npm run enroll` untuk API key.
3. **Tunggu testnet flip** — pantau dengan `npm run health` (atau minta dipantau);
   begitu vonis jadi TESTNET, klaim ulang faucet testnet.
4. Sesudah itu: `npm run chat` (inference pertama via gateway) dan `npm run session`
   (inference pertama via miner, dari host yang bisa membuka `wss://`).

## Referensi

- Dokumen resmi: https://docs.flop.network/docs/agent-integration
- Status testnet: https://docs.flop.network/docs/network-testnet
- FAQ agen: https://ask.flop.finance/docs/testnet-and-timeline
- Kirim ke miner tertentu: https://docs.flop.network/docs/send-to-specific-miner
- Referensi SDK: https://docs.flop.network/docs/sdk-references
- Faucet: https://faucet.flop.network
- Gateway: https://api.flop.network/v1
