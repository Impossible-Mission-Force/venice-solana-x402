//   npm run agent -- "your task prompt here"
import "dotenv/config";
import { runAgentTask } from "../src/agent.js";

async function main() {
  const sk = process.env.SOLANA_SECRET_KEY;
  if (!sk) {
    console.error("Set SOLANA_SECRET_KEY in .env (base58 secret key). See .env.example.");
    process.exit(1);
  }

  const task =
    process.argv.slice(2).join(" ").trim() ||
    "Summarize today's macro risk for a Solana trading agent in 3 bullets.";

  console.log("Task:", task, "\n");

  const result = await runAgentTask(
    {
      secretKey: sk,
      rpcUrl: process.env.SOLANA_RPC_URL,
      model: process.env.VENICE_MODEL,
      memoTag: process.env.MEMO_TAG,
    },
    task,
  );

  console.log("Venice output:\n" + result.output + "\n");
  console.log("On-chain memo:", result.memoSignature);
  console.log("Explorer:", result.explorer);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
