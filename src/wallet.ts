import { DurableObject } from "cloudflare:workers";
import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  type PublicClient,
  type Chain,
  type WalletClient,
  type HttpTransport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import type { StoredTx, SubmitTxRequest, TxParams } from "./types";

export interface WalletEnv {
  RPC_URL: string;
  PRIVATE_KEY: string;
  CHAIN_ID?: string;
  MAX_SUBMITTED?: string;
}

interface WalletState {
  pendingNonce: number;    // Next nonce to assign
  submittedNonce: number;  // Last nonce submitted to chain
  confirmedNonce: number;  // Last confirmed nonce
}

// Storage keys
const STATE_KEY = "state";
const TX_PREFIX = "tx:";

const ALARM_INTERVAL_MS = 5_000;
const DEFAULT_MAX_SUBMITTED = 3;

export class WalletDurableObject extends DurableObject<WalletEnv> {
  private walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount> | null = null;
  private publicClient: PublicClient | null = null;

  private getChain(): Chain {
    const chainId = this.env.CHAIN_ID ? parseInt(this.env.CHAIN_ID) : 1;
    return { ...mainnet, id: chainId };
  }

  private getClients() {
    if (!this.walletClient || !this.publicClient) {
      const chain = this.getChain();
      const transport = http(this.env.RPC_URL);
      const account = privateKeyToAccount(this.env.PRIVATE_KEY as Hex);

      this.walletClient = createWalletClient({
        account,
        chain,
        transport,
      });

      this.publicClient = createPublicClient({
        chain,
        transport,
      });
    }
    return {
      walletClient: this.walletClient!,
      publicClient: this.publicClient!,
      address: this.walletClient!.account.address,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (method === "POST" && path === "/send") {
        return await this.handleSubmitTransaction(request);
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    await this.processNextPendingTx();
  }

  private async handleSubmitTransaction(request: Request): Promise<Response> {
    const body = (await request.json()) as SubmitTxRequest;

    const state = await this.getOrInitState();

    // Get and increment pending nonce
    const nonce = state.pendingNonce;
    state.pendingNonce++;

    const params: TxParams = {
      to: body.to,
      value: body.value ? BigInt(body.value) : undefined,
      data: body.data,
      gas: body.gasLimit ? BigInt(body.gasLimit) : undefined,
    };

    const storedTx: StoredTx = {
      nonce,
      params,
      createdAt: Date.now(),
    };

    await this.ctx.storage.put({
      [STATE_KEY]: state,
      [`${TX_PREFIX}${nonce}`]: storedTx,
    });
    await this.ensureAlarmScheduled();

    return Response.json({
      nonce,
      status: "pending",
    });
  }

  private async getOrInitState(): Promise<WalletState> {
    const state = await this.ctx.storage.get<WalletState>(STATE_KEY);
    if (state) return state;

    const { publicClient, address } = this.getClients();
    const chainNonce = await publicClient.getTransactionCount({ address });
    const lastConfirmed = chainNonce - 1;

    const newState: WalletState = {
      pendingNonce: chainNonce,
      submittedNonce: lastConfirmed,
      confirmedNonce: lastConfirmed,
    };

    await this.ctx.storage.put(STATE_KEY, newState);
    return newState;
  }

  private async processNextPendingTx(): Promise<void> {
    const { walletClient, publicClient, address } = this.getClients();
    const maxSubmitted = this.env.MAX_SUBMITTED
      ? parseInt(this.env.MAX_SUBMITTED)
      : DEFAULT_MAX_SUBMITTED;

    const state = await this.getOrInitState();

    // Step 1: Check chain for confirmations
    const chainNonce = await publicClient.getTransactionCount({ address });
    const lastConfirmedOnChain = chainNonce - 1;

    if (lastConfirmedOnChain > state.confirmedNonce) {
      state.confirmedNonce = lastConfirmedOnChain;
    }

    // Step 2: Submit new txs up to MAX_SUBMITTED in flight
    const inFlight = state.submittedNonce - state.confirmedNonce;
    const canSubmit = Math.max(0, maxSubmitted - inFlight);
    const lastNonceToSubmit = Math.min(
      state.submittedNonce + canSubmit,
      state.pendingNonce - 1
    );

    for (let nonce = state.submittedNonce + 1; nonce <= lastNonceToSubmit; nonce++) {
      const tx = await this.ctx.storage.get<StoredTx>(`${TX_PREFIX}${nonce}`);
      if (!tx) continue;

      try {
        const hash = await walletClient.sendTransaction({
          ...tx.params,
          nonce: tx.nonce,
        });

        tx.hash = hash;
        await this.ctx.storage.put(`${TX_PREFIX}${nonce}`, tx);
        state.submittedNonce = nonce;
      } catch (err) {
        // Stop submitting on error - subsequent txs depend on this one
        tx.error = err instanceof Error ? err.message : "Unknown error";
        await this.ctx.storage.put(`${TX_PREFIX}${nonce}`, tx);
        break;
      }
    }

    // Save state
    await this.ctx.storage.put(STATE_KEY, state);

    // Reschedule if there's still work to do
    if (state.pendingNonce - 1 !== state.confirmedNonce) {
      await this.ensureAlarmScheduled();
    }
  }

  private async ensureAlarmScheduled(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }
}
