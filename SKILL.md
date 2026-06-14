---
name: venice-solana-x402
description: >
  Pay for Venice AI private inference from a Solana wallet using x402, and
  settle agent output on-chain. Use when an agent needs keyless, pay-per-call
  access to Venice models funded by USDC on Solana, or needs to write a
  verifiable record of its output to Solana.
---

# Venice on Solana via x402

Venice exposes its paid API over x402 wallet auth. The official SDK speaks Base
(EVM). This skill speaks Solana: Sign-In-With-Solana auth, USDC top-up on
Solana, and an on-chain memo for settlement. The flow is verified end to end
against the live api.venice.ai endpoints.

## Setup

1. `npm install` in this folder.
2. Copy `.env.example` to `.env` and set `SOLANA_SECRET_KEY` (base58) for a
   dedicated automation wallet. Fund it with about 6 USDC (SPL) and 0.02 SOL.
3. Run the probe: `npm run probe`. It prints the live Solana payment contract
   and confirms auth returns 200.

## Use it from code

```ts
import { VeniceSolanaClient } from "./src/client.js";

const venice = new VeniceSolanaClient({
  secretKey: process.env.SOLANA_SECRET_KEY,
  model: "venice-uncensored",
});

await venice.ensureFunded();
const text = await venice.chat([{ role: "user", content: "..." }]);
```

## Run the reference agent

```bash
npm run agent -- "Summarize macro risk in 3 bullets"
```

It funds the wallet if needed, runs the prompt through a private Venice model,
then writes `tag:hash:snippet` to Solana via the Memo program and prints the
transaction signature.

## Solana specifics (not in the public guide)

- Auth: `X-Sign-In-With-X` carries a Sign-In-With-Solana message; the signature
  may be base58 or base64, but the chain must be sent as `chainId` set to
  `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. A `network` field is rejected.
- Fees: the 402 `extra.feePayer` is the facilitator, which sponsors the top-up
  fee. The wallet only needs USDC to top up. SOL is spent only on the memo.
- Payload: Venice wants the canonical x402 PaymentPayload
  (`{x402Version, resource, accepted, payload}`). The flat shape that
  `x402@1.2.0` emits is rejected. `buildSolanaPaymentHeader` rewraps it.

## Fork points

- `src/agent.ts` runAgentTask: replace the prompt with your task.
- `src/agent.ts` writeMemo: replace the memo with a call to your own program, a
  swap, or a transfer.
- `src/x402.ts` buildSolanaPaymentHeader: the canonical top-up envelope, the one
  piece tied to the Venice Solana facilitator.

## Files

| File | Role |
| --- | --- |
| src/siws.ts | Sign-In-With-Solana auth header |
| src/x402.ts | balance, top-up, request wrapper |
| src/client.ts | VeniceSolanaClient |
| src/agent.ts | reference loop, inference to on-chain memo |
| src/probe.ts | prints the live contract, confirms auth |
