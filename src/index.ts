import { WalletDurableObject } from "./wallet";
import { WalletPoolDurableObject } from "./pool";
import type { SubmitTxRequest } from "./types";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex, parseAbiItem, encodeFunctionData } from "viem";

export { WalletDurableObject, WalletPoolDurableObject };

let cachedAddresses: string[] | null = null;
function getAddresses(privateKeys: string): string[] {
  if (!cachedAddresses) {
    cachedAddresses = privateKeys
      .split(",")
      .map((k) => privateKeyToAccount(k.trim() as Hex).address.toLowerCase());
  }
  return cachedAddresses;
}

export interface Env {
  WALLET: DurableObjectNamespace<WalletDurableObject>;
  WALLET_POOL: DurableObjectNamespace<WalletPoolDurableObject>;
  RPC_URL: string;
  PRIVATE_KEYS: string;
  CHAIN_ID: string;
  API_KEY?: string;
}

function validateTxRequest(body: SubmitTxRequest): string | null {
  if (!body.to) return "Missing 'to' address";
  if (body.abi) {
    try {
      const abiItem = parseAbiItem(`function ${body.abi}`);
      encodeFunctionData({
        abi: [abiItem],
        functionName: abiItem.name,
        args: body.args ?? [],
      });
    } catch (err) {
      return `Invalid abi/args: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth check (skipped if API_KEY is not set)
    if (env.API_KEY && path !== "/health") {
      const token = request.headers
        .get("Authorization")
        ?.replace("Bearer ", "");
      if (token !== env.API_KEY) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Route: POST /pool/send - auto-select wallet from pool
    if (request.method === "POST" && path === "/pool/send") {
      const body = (await request.json()) as SubmitTxRequest;
      const validationError = validateTxRequest(body);
      if (validationError) {
        return Response.json({ error: validationError }, { status: 400 });
      }

      // Get next wallet address from pool
      const pool = env.WALLET_POOL.getByName("default");
      const address = await pool.getNextWallet();

      // Forward to that wallet's DO
      const wallet = env.WALLET.getByName(address);
      const walletResponse = await wallet.handleSubmitTransaction(
        address,
        body,
      );
      return Response.json({ ...walletResponse, wallet: address });
    }

    // Route: GET /pool/wallets - list all wallets in pool
    if (request.method === "GET" && path === "/pool/wallets") {
      return Response.json({ wallets: getAddresses(env.PRIVATE_KEYS) });
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

      if (!getAddresses(env.PRIVATE_KEYS).includes(address)) {
        return Response.json({ error: "Wallet not found" }, { status: 404 });
      }

      if (subPath === "/send" && request.method === "POST") {
        const body = (await request.json()) as SubmitTxRequest;
        const validationError = validateTxRequest(body);
        if (validationError) {
          return Response.json({ error: validationError }, { status: 400 });
        }

        // Get or create DO instance for this wallet address
        const stub = env.WALLET.getByName(address);
        const walletResponse = await stub.handleSubmitTransaction(
          address,
          body,
        );
        return Response.json({ ...walletResponse, wallet: address });
      }

      // POST /wallets/:address/reset - clear all state and re-sync from chain
      if (subPath === "/reset" && request.method === "POST") {
        const stub = env.WALLET.getByName(address);
        await stub.reset();
        return Response.json({ wallet: address, status: "reset" });
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
        const status = await stub.getStatus(address);
        return Response.json({ wallet: address, ...status });
      }

      // GET /wallets/:address/txs - batch get transactions
      if (subPath === "/txs" && request.method === "GET") {
        const fromRaw = url.searchParams.get("from");
        const toRaw = url.searchParams.get("to");
        const from = fromRaw != null ? parseInt(fromRaw, 10) : undefined;
        const to = toRaw != null ? parseInt(toRaw, 10) : undefined;

        if (
          (from !== undefined && (isNaN(from) || from < 0)) ||
          (to !== undefined && (isNaN(to) || to < 0)) ||
          (from !== undefined &&
            to !== undefined &&
            (from > to || to - from > 99))
        ) {
          return Response.json({ error: "Invalid range: 'from' and 'to' must be a positive range of 100 or less" }, { status: 400 });
        }

        const stub = env.WALLET.getByName(address);
        const result = await stub.getTransactions(from, to);
        const transactions = result.transactions.map((tx) => ({
          ...tx,
          wallet: address,
        }));
        return Response.json({
          wallet: address,
          transactions,
          availableRange: result.availableRange,
        });
      }

      // GET /wallets/:address/tx/:nonce - get specific transaction
      const txMatch = subPath.match(/^\/tx\/(\d+)$/);
      if (txMatch && request.method === "GET") {
        const nonce = parseInt(txMatch[1], 10);
        const stub = env.WALLET.getByName(address);
        const tx = await stub.getTransaction(nonce);
        if (!tx) {
          return Response.json(
            { error: "Transaction not found" },
            { status: 404 },
          );
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
