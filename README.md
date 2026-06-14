# venice-solana-x402

A Solana adapter for Venice AI x402 wallet auth.

Venice supports x402 on Solana for both the top-up endpoint and wallet inference
auth, but the developer guide and the official
[venice-x402-client](https://github.com/veniceai/x402-client) still only cover
Base (chainId 8453). This library handles the Solana path: authenticate a Solana
wallet, pay for inference with USDC on Solana, and settle agent output on-chain.
No API key, no account.

The flow is verified end to end against the live api.venice.ai endpoints: wallet
auth, USDC top-up on Solana mainnet, private inference drawn from the resulting
balance, and an on-chain Memo for settlement.

It ships as a small TypeScript library plus a `SKILL.md` for Claude Code, Cursor
and Codex.

## Contents

- `src/siws.ts`: Sign-In-With-Solana, producing the `X-Sign-In-With-X` header.
- `src/x402.ts`: balance, top-up and a request wrapper. The top-up payment is
  built from the `accepts` array the server returns, so nothing is hardcoded.
- `src/client.ts`: `VeniceSolanaClient.chat()` with auto top-up.
- `src/agent.ts`: a reference agent that pays per call for a private Venice model
  and writes `tag:hash:snippet` to Solana via the Memo program.
- `src/probe.ts`: prints the live Solana contract and confirms auth.

## Quickstart

```bash
npm install
cp .env.example .env
# set SOLANA_SECRET_KEY in .env, fund the wallet with USDC and a little SOL
npm run probe
npm run agent -- "Summarize macro risk in 3 bullets"
```

## How the Solana path differs from Base

Three things are specific to Solana on Venice and are not in the public guide.

Auth. The `X-Sign-In-With-X` header carries a Sign-In-With-Solana message and a
signature. Venice accepts the signature as base58 or base64, but the chain must
be sent as `chainId` set to the CAIP-2 id
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. A `network` field, or the short
`solana` alias, is rejected with 401.

Payment contract. The 402 response carries `x402Version: 2` and a Solana
`accepts` entry with `scheme: exact`, the USDC SPL mint as `asset`, and an
`extra.feePayer` set to the facilitator. The facilitator sponsors the top-up
transaction fee, so the wallet only needs USDC to top up. SOL is only spent by
the agent's own memo.

Payment payload. This is the part that bites. x402@1.2.0, the latest npm release,
still emits the older flat `PaymentPayload` shape
`{scheme, network, x402Version, payload}`. Venice implements the current x402
spec, which wraps the requirement in `accepted` and adds a `resource` object:

```json
{
  "x402Version": 2,
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepted": { "scheme": "exact", "network": "solana:5eykt4...", "amount": "5000000",
                "asset": "EPjFW...", "payTo": "...", "maxTimeoutSeconds": 300, "extra": {} },
  "payload": { "transaction": "<base64 partially-signed tx>" }
}
```

Sending the flat shape returns `400 Could not extract payment info from payload`.
`buildSolanaPaymentHeader` signs the transaction with x402, then rewraps it in
the canonical envelope before sending it in the `X-402-Payment` header.

## Safety

Use a dedicated automation wallet, not your treasury. The agent moves USDC to
top up Venice and pays SOL gas for the memo.

## License

MIT
