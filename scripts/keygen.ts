// npm run keygen
// Prints a fresh Solana keypair. Put SECRET into .env as SOLANA_SECRET_KEY,
// then fund the PUBKEY with a little SOL (gas) and USDC (Venice top-up).
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
console.log("PUBKEY:", kp.publicKey.toBase58());
console.log("SECRET (base58):", bs58.encode(kp.secretKey));
