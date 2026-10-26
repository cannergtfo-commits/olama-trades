import fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { KEYPAIR_PATH, WALLET_DIR, loadConfig } from "./config.js";
import { addTx } from "./history.js";

function ensureWalletDir(): void {
  if (!fs.existsSync(WALLET_DIR)) {
    fs.mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(WALLET_DIR, 0o700);
  } catch {
    /* best-effort on some FS */
  }
}

export function walletExists(): boolean {
  return fs.existsSync(KEYPAIR_PATH);
}

export function createWallet(): { publicKey: string; path: string } {
  ensureWalletDir();
  if (fs.existsSync(KEYPAIR_PATH)) {
    throw new Error(`Wallet already exists at ${KEYPAIR_PATH}. Delete it manually if you want a new one.`);
  }
  const kp = Keypair.generate();
  const secret = Array.from(kp.secretKey);
  fs.writeFileSync(KEYPAIR_PATH, JSON.stringify(secret), { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(KEYPAIR_PATH, 0o600);
  } catch {
    /* best-effort */
  }
  return { publicKey: kp.publicKey.toBase58(), path: KEYPAIR_PATH };
}

export function loadKeypair(): Keypair {
  if (!fs.existsSync(KEYPAIR_PATH)) {
    throw new Error("No wallet found. Run: npm run bot -- wallet create");
  }
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  const arr = JSON.parse(raw) as number[];
  if (!Array.isArray(arr) || arr.length < 64) {
    throw new Error("Invalid keypair file format");
  }
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export function getAddress(): string {
  return loadKeypair().publicKey.toBase58();
}

export function getConnection(): Connection {
  const cfg = loadConfig();
  return new Connection(cfg.rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
}

export async function getBalanceSol(): Promise<number> {
  const conn = getConnection();
  const kp = loadKeypair();
  const lamports = await conn.getBalance(kp.publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

export function validatePubkey(dest: string): PublicKey {
  try {
    return new PublicKey(dest);
  } catch {
    throw new Error(`Invalid destination pubkey: ${dest}`);
  }
}

export async function withdrawSol(to: string, amountSol: number): Promise<string> {
  if (!(amountSol > 0) || !Number.isFinite(amountSol)) {
    throw new Error("Amount must be a positive number");
  }
  const dest = validatePubkey(to);
  const cfg = loadConfig();
  const kp = loadKeypair();
  if (dest.equals(kp.publicKey)) {
    throw new Error("Cannot withdraw to the same wallet");
  }
  const conn = getConnection();
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (cfg.dryRun) {
    addTx({
      kind: "withdraw",
      amountSol,
      destination: dest.toBase58(),
      dryRun: true,
      note: "DRY_RUN withdraw",
    });
    return `DRY_RUN: would withdraw ${amountSol} SOL to ${dest.toBase58()}`;
  }
  const balance = await conn.getBalance(kp.publicKey);
  const feeReserve = 5000;
  if (lamports + feeReserve > balance) {
    throw new Error(
      `Insufficient balance. Have ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL, need ~${amountSol} + fees`
    );
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: dest,
      lamports,
    })
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  addTx({
    kind: "withdraw",
    amountSol,
    destination: dest.toBase58(),
    signature: sig,
    dryRun: false,
    note: "withdraw",
  });
  return sig;
}

/** Never log or return the secret key. */
export function safeWalletInfo(): { address: string; keypairPath: string; exists: boolean } {
  const exists = walletExists();
  return {
    exists,
    address: exists ? getAddress() : "",
    keypairPath: KEYPAIR_PATH,
  };
}
