import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  VENICE_BASE,
  getBalance,
  topUp,
  x402Request,
  type BalanceInfo,
} from "./x402.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export class VeniceSolanaClient {
  readonly keypair: Keypair;
  readonly secretKeyBase58: string;
  readonly connection: Connection;
  readonly defaultModel: string;

  constructor(opts: {
    secretKey: string | Uint8Array;
    rpcUrl?: string;
    model?: string;
  }) {
    this.keypair =
      typeof opts.secretKey === "string"
        ? Keypair.fromSecretKey(bs58.decode(opts.secretKey))
        : Keypair.fromSecretKey(opts.secretKey);
    this.secretKeyBase58 =
      typeof opts.secretKey === "string"
        ? opts.secretKey
        : bs58.encode(opts.secretKey);
    this.connection = new Connection(
      opts.rpcUrl ?? "https://api.mainnet-beta.solana.com",
      "confirmed",
    );
    this.defaultModel = opts.model ?? "venice-uncensored";
  }

  get address(): string {
    return this.keypair.publicKey.toBase58();
  }

  balance(): Promise<BalanceInfo> {
    return getBalance(this.keypair);
  }

  topUp(): Promise<unknown> {
    return topUp(this.secretKeyBase58);
  }

  // Top up if the wallet currently cannot pay.
  async ensureFunded(): Promise<BalanceInfo> {
    const b = await this.balance().catch(() => null);
    if (!b || !b.canConsume) {
      await this.topUp();
      return this.balance();
    }
    return b;
  }

  // Chat completion with auto top-up. Returns the assistant text.
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await x402Request(
      this.keypair,
      "/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model ?? this.defaultModel,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.max_tokens,
        }),
      },
      { secretKeyBase58: this.secretKeyBase58, autoTopUp: true },
    );
    if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
}

export { VENICE_BASE };
