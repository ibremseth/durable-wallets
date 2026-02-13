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
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth check (skipped if API_KEY is not set)
    if (env.API_KEY && path !== "/health") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (token !== env.API_KEY) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

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

    // Route: GET /pool/disabled - get disabled wallets
    if (request.method === "GET" && path === "/pool/disabled") {
      const pool = env.WALLET_POOL.getByName("default");
      const disabled = await pool.getDisabledWallets();
      return Response.json({ disabled });
    }

    // Route: POST /pool/refresh - trigger immediate balance recheck
    if (request.method === "POST" && path === "/pool/refresh") {
      const pool = env.WALLET_POOL.getByName("default");
      const result = await pool.refresh();
      return Response.json(result);
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

      // POST /wallets/:address/poll - force-trigger alarm loop
      if (subPath === "/poll" && request.method === "POST") {
        const stub = env.WALLET.getByName(address);
        const result = await stub.poll();
        return Response.json({ wallet: address, ...result });
      }

      // GET /wallets/:address/status - get wallet status
      if (subPath === "/status" && request.method === "GET") {
        const stub = env.WALLET.getByName(address);
        const status = await stub.getStatus();
        if (!status) {
          return Response.json({ error: "Wallet not initialized" }, { status: 404 });
        }
        return Response.json({ wallet: address, ...status });
      }

      // GET /wallets/:address/tx/:nonce - get specific transaction
      const txMatch = subPath.match(/^\/tx\/(\d+)$/);
      if (txMatch && request.method === "GET") {
        const nonce = parseInt(txMatch[1], 10);
        const stub = env.WALLET.getByName(address);
        const tx = await stub.getTransaction(nonce);
        if (!tx) {
          return Response.json({ error: "Transaction not found" }, { status: 404 });
        }
        return Response.json({ wallet: address, ...tx });
      }
    }

    // Health check
    if (path === "/health") {
      return Response.json({ status: "ok" });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
