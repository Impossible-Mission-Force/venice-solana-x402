import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { VeniceSolanaClient, type ChatMessage } from "./client.js";

// SPL Memo program.
export const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// Write a UTF-8 string to Solana as a memo. Returns the signature.
export async function writeMemo(
  connection: Connection,
  payer: Keypair,
  memo: string,
): Promise<string> {
  const ix = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf8"),
  });
  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
}

export interface AgentResult {
  prompt: string;
  output: string;
  memoSignature: string;
  explorer: string;
}

export interface AgentConfig {
  secretKey: string;
  rpcUrl?: string;
  model?: string;
  memoTag?: string;
}

// Run one task: fund the wallet, run the prompt through Venice, write a compact
// record (tag, output hash, snippet) on-chain. Swap the prompt and writeMemo
// for your own task and action.
export async function runAgentTask(
  cfg: AgentConfig,
  task: string,
): Promise<AgentResult> {
  const venice = new VeniceSolanaClient({
    secretKey: cfg.secretKey,
    rpcUrl: cfg.rpcUrl,
    model: cfg.model,
  });

  await venice.ensureFunded();

  const messages: ChatMessage[] = [
    { role: "system", content: "You are an autonomous on-chain agent. Answer concisely." },
    { role: "user", content: task },
  ];
  const output = await venice.chat(messages, { max_tokens: 512 });

  const digest = createHash("sha256").update(output, "utf8").digest("hex").slice(0, 16);
  const tag = cfg.memoTag ?? "vsx";
  const memo = `${tag}:${digest}:${output.slice(0, 180)}`;

  const sig = await writeMemo(venice.connection, venice.keypair, memo);

  return {
    prompt: task,
    output,
    memoSignature: sig,
    explorer: `https://solscan.io/tx/${sig}`,
  };
}
