import { DurableObject } from "cloudflare:workers";

export interface WalletEnv {
  // Add any bindings the DO needs here
}

export class WalletDurableObject extends DurableObject<WalletEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // POST /send - submit a new transaction
    if (method === "POST" && path === "/send") {
      return this.handleSubmitTransaction(request);
    }

    // GET /transactions/:hash - get transaction status
    const txMatch = path.match(/^\/transactions\/([^/]+)$/);
    if (method === "GET" && txMatch) {
      const txHash = txMatch[1];
      return this.handleGetTransaction(txHash);
    }

    // GET / - wallet info
    if (method === "GET" && path === "/") {
      return this.handleGetWallet();
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private async handleSubmitTransaction(request: Request): Promise<Response> {
    // TODO: implement transaction submission
    return Response.json({ message: "Not implemented" }, { status: 501 });
  }

  private async handleGetTransaction(txId: string): Promise<Response> {
    // TODO: implement transaction status lookup
    return Response.json({ message: "Not implemented" }, { status: 501 });
  }

  private async handleGetWallet(): Promise<Response> {
    // TODO: return wallet state
    return Response.json({ message: "Not implemented" }, { status: 501 });
  }
}
