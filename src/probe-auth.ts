// Auth matrix probe. Finds the exact SIWS format Venice accepts for Solana by
// trying every combination of signature encoding and chain field against
// GET /x402/balance/{addr}. A 401 means the signature was rejected; anything
// else means the format was accepted. Run once, then set DEFAULT_AUTH_VARIANT
// in src/siws.ts to the winner.
//
//   npm run probe:auth

import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { VENICE_BASE } from "./x402.js";
import {
  buildSolanaAuthHeader,
  SOLANA_CAIP2,
  type AuthVariant,
  type SigEncoding,
} from "./siws.js";

function loadKeypair(): Keypair {
  const sk = process.env.SOLANA_SECRET_KEY;
  if (!sk) {
    console.log("No SOLANA_SECRET_KEY set, using a throwaway keypair (balance auth needs no funds).");
    return Keypair.generate();
  }
  return Keypair.fromSecretKey(bs58.decode(sk));
}

const encodings: SigEncoding[] = ["base58", "base64", "hex"];
const chainFields: Array<{ chainKey: "chainId" | "network"; chainValue: string }> = [
  { chainKey: "chainId", chainValue: SOLANA_CAIP2 },
  { chainKey: "network", chainValue: "solana" },
  { chainKey: "network", chainValue: SOLANA_CAIP2 },
];

async function main() {
  const kp = loadKeypair();
  const addr = kp.publicKey.toBase58();
  const resource = `${VENICE_BASE}/x402/balance/${addr}`;
  console.log("Wallet:", addr);
  console.log("Probing GET /x402/balance with 9 SIWS variants. 401 = signature rejected.\n");

  const rows: string[] = [];
  let winner: AuthVariant | null = null;

  for (const sigEncoding of encodings) {
    for (const cf of chainFields) {
      const variant: AuthVariant = { sigEncoding, ...cf };
      let status = 0;
      let body = "";
      try {
        const res = await fetch(resource, {
          headers: {
            "X-Sign-In-With-X": buildSolanaAuthHeader(
              kp,
              { domain: "api.venice.ai", uri: resource },
              variant,
            ),
          },
        });
        status = res.status;
        body = (await res.text()).slice(0, 100).replace(/\s+/g, " ");
      } catch (e) {
        body = "fetch error: " + (e as Error).message;
      }
      const authPassed = status !== 0 && status !== 401;
      const label = `${sigEncoding.padEnd(7)} ${cf.chainKey}=${cf.chainValue}`;
      const mark = authPassed ? (status === 200 ? "  <== 200 OK" : "  <== sig accepted") : "";
      rows.push(`[${String(status).padStart(3)}] ${label}${mark}`);
      if (body) rows.push(`      ${body}`);
      if (authPassed && !winner) winner = variant;
    }
  }

  console.log(rows.join("\n"));
  console.log("");
  if (winner) {
    console.log("WINNER:", JSON.stringify(winner));
    console.log("This SIWS format was accepted. Set DEFAULT_AUTH_VARIANT in src/siws.ts to it (already the default if it matches), then run: npm run probe");
  } else {
    console.log("Every combo returned 401. The signed message structure itself likely differs from what Venice expects. Paste this whole table back.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
