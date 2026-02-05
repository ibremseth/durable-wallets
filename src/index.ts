import { WalletDurableObject } from './wallet';

export { WalletDurableObject };

export interface Env {
  WALLET: DurableObjectNamespace;
  RPC_URL: string;
  PRIVATE_KEY: string;
  CHAIN_ID?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route: /wallets/:address/*
    const walletMatch = path.match(/^\/wallets\/([^/]+)(\/.*)?$/);
    if (walletMatch) {
      const address = walletMatch[1];
      const subPath = walletMatch[2] || '/';

      // Get or create DO instance for this wallet address
      const id = env.WALLET.idFromName(address.toLowerCase());
      const stub = env.WALLET.get(id);

      // Forward request to the Durable Object
      const doUrl = new URL(request.url);
      doUrl.pathname = subPath;
      return stub.fetch(new Request(doUrl, request));
    }

    // Health check
    if (path === '/health') {
      return Response.json({ status: 'ok' });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
