import nacl from "tweetnacl";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

// Builds the X-Sign-In-With-X auth header for a Solana wallet (Venice's own
// scheme, not part of x402). The Base flow signs an EIP-4361 message and sends
// { address, message, signature(hex), timestamp, chainId:8453 }. The Solana
// variant signs a Sign-In-With-Solana message with the ed25519 key; the exact
// signature encoding and chain field are confirmed by probe-auth.

export const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export type SigEncoding = "base58" | "base64" | "hex";

export interface AuthVariant {
  sigEncoding: SigEncoding;
  chainKey: "chainId" | "network";
  chainValue: string;
}

// Best current guess. probe-auth confirms or corrects this in one run.
export const DEFAULT_AUTH_VARIANT: AuthVariant = {
  sigEncoding: "base64",
  chainKey: "chainId",
  chainValue: SOLANA_CAIP2,
};

export interface SiwsOptions {
  domain: string;
  statement?: string;
  uri: string;
  chainId?: string;
  version?: string;
}

export function formatSiwsMessage(address: string, opts: SiwsOptions): string {
  const now = new Date();
  const issuedAt = now.toISOString();
  const expirationTime = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const nonce = bs58.encode(nacl.randomBytes(8));
  const version = opts.version ?? "1";
  const chainId = opts.chainId ?? SOLANA_CAIP2;
  const statement = opts.statement ?? "Sign in to Venice AI";

  return [
    `${opts.domain} wants you to sign in with your Solana account:`,
    address,
    ``,
    statement,
    ``,
    `URI: ${opts.uri}`,
    `Version: ${version}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join("\n");
}

function encodeSig(sig: Uint8Array, enc: SigEncoding): string {
  if (enc === "base58") return bs58.encode(sig);
  if (enc === "hex") return "0x" + Buffer.from(sig).toString("hex");
  return Buffer.from(sig).toString("base64");
}

export function buildSolanaAuthHeader(
  keypair: Keypair,
  opts: SiwsOptions,
  variant: AuthVariant = DEFAULT_AUTH_VARIANT,
): string {
  const address = keypair.publicKey.toBase58();
  const message = formatSiwsMessage(address, { ...opts, chainId: variant.chainValue });
  const sigBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);

  const payload: Record<string, unknown> = {
    address,
    message,
    signature: encodeSig(sigBytes, variant.sigEncoding),
    timestamp: Date.now(),
  };
  payload[variant.chainKey] = variant.chainValue;

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}
