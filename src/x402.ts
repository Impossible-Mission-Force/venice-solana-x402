import { Keypair } from "@solana/web3.js";
import { createSigner } from "x402/types";
import { createPaymentHeader } from "x402/client";
import {
  buildSolanaAuthHeader,
  type SiwsOptions,
  type AuthVariant,
} from "./siws.js";

export const VENICE_BASE = "https://api.venice.ai/api/v1";

// Subset of the x402 accepts entry we read. Venice returns `amount` (v2),
// while the x402 PaymentRequirements type uses `maxAmountRequired`.
export interface PaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount?: string;
  maxAmountRequired?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export interface BalanceInfo {
  canConsume: boolean;
  balanceUsd: number;
  minimumTopUpUsd?: number;
  suggestedTopUpUsd?: number;
  diemBalanceUsd?: number;
}

function authOpts(resource: string): SiwsOptions {
  return { domain: "api.venice.ai", uri: resource };
}

export async function getBalance(kp: Keypair, variant?: AuthVariant): Promise<BalanceInfo> {
  const addr = kp.publicKey.toBase58();
  const resource = `${VENICE_BASE}/x402/balance/${addr}`;
  const res = await fetch(resource, {
    method: "GET",
    headers: { "X-Sign-In-With-X": buildSolanaAuthHeader(kp, authOpts(resource), variant) },
  });
  if (!res.ok) throw new Error(`balance ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return (json?.data ?? json) as BalanceInfo;
}

// Find the Solana exact entry in the accepts array.
export function pickSolanaRequirement(accepts: PaymentRequirement[]): PaymentRequirement {
  const sol = accepts.find((a) => /sol/i.test(a.network) && a.scheme === "exact");
  if (!sol) {
    throw new Error(
      `No Solana 'exact' entry in accepts. Server offered: ${accepts
        .map((a) => `${a.scheme}/${a.network}`)
        .join(", ")}.`,
    );
  }
  return sol;
}

// x402 createPaymentHeader expects the short alias ("solana"), not the CAIP-2
// id Venice returns. Map mainnet to the alias.
function svmNetworkAlias(network: string): string {
  if (network === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" || network === "solana") return "solana";
  if (/^solana:/i.test(network)) return "solana-devnet";
  return network;
}

// Normalize Venice's accepts entry into the x402 PaymentRequirements shape.
function toX402Requirement(req: PaymentRequirement): any {
  return {
    scheme: req.scheme,
    network: svmNetworkAlias(req.network),
    maxAmountRequired: String(req.amount ?? req.maxAmountRequired ?? "0"),
    resource: req.resource ?? `${VENICE_BASE}/x402/top-up`,
    description: req.description ?? "Venice x402 top-up",
    mimeType: req.mimeType ?? "application/json",
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds ?? 300,
    asset: req.asset,
    extra: req.extra ?? null,
  };
}

// Build the X-402-Payment header for the Solana exact scheme using the official
// x402 client. createPaymentHeader builds and signs the SPL transfer with the
// facilitator fee payer from `extra`, then base64-encodes the payment payload.
export async function buildSolanaPaymentHeader(
  secretKeyBase58: string,
  req: PaymentRequirement,
): Promise<string> {
  const signer = await createSigner("solana", secretKeyBase58);
  const built = await createPaymentHeader(signer, 2, toX402Requirement(req));
  const flat = JSON.parse(Buffer.from(built, "base64").toString("utf8"));
  const transaction = flat?.payload?.transaction;
  // Venice implements the canonical x402 PaymentPayload: the requirement is
  // wrapped in `accepted` and a `resource` object is included. The flat x402
  // shape is rejected with "Could not extract payment info from payload".
  const canonical = {
    x402Version: 2,
    resource: {
      url: req.resource ?? `${VENICE_BASE}/x402/top-up`,
      description: req.description ?? "Venice x402 top-up",
      mimeType: req.mimeType ?? "application/json",
    },
    accepted: {
      scheme: req.scheme,
      network: req.network,
      amount: String(req.amount ?? req.maxAmountRequired ?? "0"),
      asset: req.asset,
      payTo: req.payTo,
      maxTimeoutSeconds: req.maxTimeoutSeconds ?? 300,
      extra: req.extra ?? null,
    },
    payload: { transaction },
  };
  return Buffer.from(JSON.stringify(canonical), "utf8").toString("base64");
}

// POST /x402/top-up, read the 402 accepts, build the Solana payment, retry.
export async function topUp(
  secretKeyBase58: string,
): Promise<{ accepts: PaymentRequirement[]; result: unknown }> {
  const url = `${VENICE_BASE}/x402/top-up`;

  const first = await fetch(url, { method: "POST" });
  if (first.status !== 402) {
    throw new Error(`expected 402 on top-up, got ${first.status}: ${await first.text()}`);
  }

  const accepts = await parseAccepts(first);
  const requirement = pickSolanaRequirement(accepts);
  const paymentHeader = await buildSolanaPaymentHeader(secretKeyBase58, requirement);

  const retry = await fetch(url, {
    method: "POST",
    headers: { "X-402-Payment": paymentHeader },
  });
  if (!retry.ok) throw new Error(`top-up retry ${retry.status}: ${await retry.text()}`);

  return { accepts, result: await retry.json().catch(() => ({})) };
}

// Read the accepts array from a 402 (PAYMENT-REQUIRED header or JSON body).
export async function parseAccepts(res: Response): Promise<PaymentRequirement[]> {
  const header =
    res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
  if (header) {
    try {
      const decoded = /^[A-Za-z0-9+/=]+$/.test(header.trim())
        ? Buffer.from(header, "base64").toString("utf8")
        : header;
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed?.accepts)) return parsed.accepts;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to body
    }
  }
  const body = await res.clone().json().catch(() => null);
  if (Array.isArray(body?.accepts)) return body.accepts as PaymentRequirement[];
  throw new Error("could not locate accepts in 402 response");
}

// Authenticated request to a paid route, with optional auto top-up on 402.
export async function x402Request(
  kp: Keypair,
  path: string,
  init: RequestInit,
  opts: { secretKeyBase58?: string; autoTopUp?: boolean; variant?: AuthVariant } = {},
): Promise<Response> {
  const resource = `${VENICE_BASE}${path}`;
  const headers = new Headers(init.headers);
  headers.set("X-Sign-In-With-X", buildSolanaAuthHeader(kp, authOpts(resource), opts.variant));

  let res = await fetch(resource, { ...init, headers });
  if (res.status === 402 && opts.autoTopUp && opts.secretKeyBase58) {
    await topUp(opts.secretKeyBase58);
    headers.set("X-Sign-In-With-X", buildSolanaAuthHeader(kp, authOpts(resource), opts.variant));
    res = await fetch(resource, { ...init, headers });
  }
  return res;
}
