import { WalletDurableObject } from "./wallet";
import { WalletPoolDurableObject } from "./pool";
import type { SubmitTxRequest } from "./types";

export { WalletDurableObject, WalletPoolDurableObject };

export interface Env {
  WALLET: DurableObjectNamespace<WalletDurableObject>;
  WALLET_POOL: DurableObjectNamespace<WalletPoolDurableObject>;
  RPC_URL: string;
  PRIVATE_KEYS: string;
  CHAIN_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route: POST /pool/send - auto-select wallet from pool
    if (request.method === "POST" && path === "/pool/send") {
      const body = (await request.json()) as SubmitTxRequest;

      // Get next wallet address from pool
      const pool = env.WALLET_POOL.getByName("default");
      const address = await pool.getNextWallet();

      // Forward to that wallet's DO
      const wallet = env.WALLET.getByName(address);
      const walletResponse = await wallet.handleSubmitTransaction(
        address,
        body,
      );

      // Include which wallet was selected in the response
      return Response.json({ ...walletResponse, wallet: address });
    }

    // Route: GET /pool/wallets - list all wallets in pool
    if (request.method === "GET" && path === "/pool/wallets") {
      const pool = env.WALLET_POOL.getByName("default");
      const wallets = await pool.getAddresses();
      return Response.json({ wallets });
    }

    // Route: /wallets/:address/* - direct wallet access
    const walletMatch = path.match(/^\/wallets\/([^/]+)(\/.*)?$/);
    if (walletMatch) {
      const address = walletMatch[1].toLowerCase();
      const subPath = walletMatch[2] || "/";

      if (subPath === "/send" && request.method === "POST") {
        const body = (await request.json()) as SubmitTxRequest;

        // Get or create DO instance for this wallet address
        const stub = env.WALLET.getByName(address);
        const walletResponse = await stub.handleSubmitTransaction(
          address,
          body,
        );

        // Include which wallet was selected in the response
        return Response.json({ ...walletResponse, wallet: address });
      }
    }

    // Health check
    if (path === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
