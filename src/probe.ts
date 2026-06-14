// Run this before moving real funds. It hits the live endpoints and prints the
// Solana x402 contract (the accepts array) and whether SIWS auth is accepted,
// so the defaults in siws.ts and x402.ts can be confirmed.
//
//   npm run probe

import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { VENICE_BASE, parseAccepts } from "./x402.js";
import { buildSolanaAuthHeader } from "./siws.js";

function loadKeypair(): Keypair {
  const sk = process.env.SOLANA_SECRET_KEY;
  if (!sk) {
    console.log("No SOLANA_SECRET_KEY set, generating a throwaway keypair for the probe.");
    return Keypair.generate();
  }
  return Keypair.fromSecretKey(bs58.decode(sk));
}

async function main() {
  const kp = loadKeypair();
  console.log("Wallet:", kp.publicKey.toBase58());
  console.log("Endpoint:", VENICE_BASE);
  console.log("");

  console.log("1. POST /x402/top-up (expect 402 with accepts)");
  try {
    const res = await fetch(`${VENICE_BASE}/x402/top-up`, { method: "POST" });
    console.log("status:", res.status);
    console.log("PAYMENT-REQUIRED header:", res.headers.get("PAYMENT-REQUIRED") ?? "(none)");
    if (res.status === 402) {
      const accepts = await parseAccepts(res).catch((e) => {
        console.log("could not parse accepts:", (e as Error).message);
        return [];
      });
      console.log("accepts:", JSON.stringify(accepts, null, 2));
      const sol = accepts.find((a: any) => /sol/i.test(a.network));
      console.log(
        sol
          ? `Solana entry: network="${sol.network}", mint="${sol.asset}", payTo="${sol.payTo}"`
          : "No Solana entry in accepts. Check the network tag in the raw array above.",
      );
    } else {
      console.log("body:", (await res.text()).slice(0, 800));
    }
  } catch (e) {
    console.log("top-up probe failed:", (e as Error).message);
  }

  console.log("");
  console.log("2. GET /x402/balance/{addr} (does SIWS auth pass?)");
  try {
    const resource = `${VENICE_BASE}/x402/balance/${kp.publicKey.toBase58()}`;
    const res = await fetch(resource, {
      headers: { "X-Sign-In-With-X": buildSolanaAuthHeader(kp, { domain: "api.venice.ai", uri: resource }) },
    });
    console.log("status:", res.status, res.status === 401 ? "(auth rejected, adjust siws.ts)" : "");
    console.log("body:", (await res.text()).slice(0, 600));
  } catch (e) {
    console.log("balance probe failed:", (e as Error).message);
  }

  console.log("");
  console.log("Confirm:");
  console.log("- siws.ts: network tag and signature encoding accepted");
  console.log("- x402.ts pickSolanaRequirement: matches the network string above");
  console.log("- x402.ts buildSolanaPaymentHeader: envelope matches the 402 contract");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
