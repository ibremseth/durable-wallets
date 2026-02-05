import { DurableObject } from "cloudflare:workers";
import {
  createWalletClient,
  createPublicClient,
  http,
  extractChain,
  encodeFunctionData,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
  type Chain,
  type WalletClient,
  type HttpTransport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import * as chains from "viem/chains";
import type { StoredTx, SubmitTxRequest, TxParams } from "./types";

export interface WalletEnv {
  RPC_URL: string;
  PRIVATE_KEYS: string;
  CHAIN_ID: string;
  MAX_SUBMITTED?: string;
}

interface WalletState {
  pendingNonce: number; // Next nonce to assign
  submittedNonce: number; // Last nonce submitted to chain
  confirmedNonce: number; // Last confirmed nonce
}

// Storage keys
const STATE_KEY = "state";
const TX_PREFIX = "tx:";
const ADDRESS_KEY = "address";

const ALARM_INTERVAL_MS = 2_000; // Should be about block time
const DEFAULT_MAX_SUBMITTED = 5;

export class WalletDurableObject extends DurableObject<WalletEnv> {
  private walletClient: WalletClient<
    HttpTransport,
    Chain,
    PrivateKeyAccount
  > | null = null;
  private publicClient: PublicClient | null = null;

  private getChain(): Chain {
    if (!this.env.CHAIN_ID) {
      throw new Error("CHAIN_ID environment variable is required");
    }
    return extractChain({
      chains: Object.values(chains),
      id: parseInt(this.env.CHAIN_ID),
    });
  }

  private getClients(walletAddress: string) {
    if (!this.walletClient || !this.publicClient) {
      const chain = this.getChain();
      const transport = http(this.env.RPC_URL);

      const keys = this.env.PRIVATE_KEYS.split(",").map((k) => k.trim());
      const myKey = keys.find(
        (k) =>
          privateKeyToAccount(k as Hex).address.toLowerCase() ===
          walletAddress.toLowerCase(),
      );

      if (!myKey) {
        throw new Error(`No private key found for wallet ${walletAddress}`);
      }

      const account = privateKeyToAccount(myKey as Hex);

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
    };
  }

  async alarm(): Promise<void> {
    // Read stored address for alarm context
    const walletAddress = await this.ctx.storage.get<string>(ADDRESS_KEY);
    if (!walletAddress) return;
    await this.processNextPendingTx(walletAddress);
  }

  async handleSubmitTransaction(
    walletAddress: string,
    body: SubmitTxRequest,
  ): Promise<{ nonce: number; status: string }> {
    // Store address for alarm to use
    await this.ctx.storage.put(ADDRESS_KEY, walletAddress.toLowerCase());

    const nonce = await this.getAndIncrementNonce(walletAddress);

    // Encode calldata from abi + args if provided, otherwise use raw data
    let calldata: Hex | undefined = body.data;
    if (body.abi) {
      const abiItem = parseAbiItem(`function ${body.abi}`);
      calldata = encodeFunctionData({
        abi: [abiItem],
        functionName: abiItem.name,
        args: body.args ?? [],
      });
    }

    const params: TxParams = {
      to: body.to,
      value: body.value ? BigInt(body.value) : undefined,
      data: calldata,
      gas: body.gasLimit ? BigInt(body.gasLimit) : undefined,
    };

    const storedTx: StoredTx = {
      nonce,
      params,
      createdAt: Date.now(),
    };

    await this.ctx.storage.put(`${TX_PREFIX}${nonce}`, storedTx);

    // If no alarm running, process immediately; otherwise let the alarm handle it
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ensureAlarmScheduled(100);
    }

    return {
      nonce,
      status: "pending",
    };
  }

  async skipNonce(walletAddress: string, nonce: number): Promise<Hex> {
    try {
      const { walletClient } = this.getClients(walletAddress);

      // Send 0-value self-transfer to cancel the stuck tx
      return await walletClient.sendTransaction({
        to: walletAddress as Address,
        value: 0n,
        nonce,
      });
    } catch (err) {
      console.log(`Error submitting skip txn on nonce ${nonce}`, err);
      return "0x";
    }
  }

  private async getAndIncrementNonce(walletAddress: string): Promise<number> {
    const state = await this.ctx.storage.get<WalletState>(STATE_KEY);
    if (state) {
      state.pendingNonce++;
      await this.ctx.storage.put(STATE_KEY, state);
      return state.pendingNonce - 1;
    }

    const { publicClient } = this.getClients(walletAddress);
    return await this.ctx.blockConcurrencyWhile(async () => {
      const chainNonce = await publicClient.getTransactionCount({
        address: walletAddress as Address,
      });
      const lastConfirmed = chainNonce - 1;

      const newState: WalletState = {
        pendingNonce: chainNonce + 1,
        submittedNonce: lastConfirmed,
        confirmedNonce: lastConfirmed,
      };

      await this.ctx.storage.put(STATE_KEY, newState);
      return newState.pendingNonce - 1;
    });
  }

  private async getOrInitState(walletAddress: string): Promise<WalletState> {
    const state = await this.ctx.storage.get<WalletState>(STATE_KEY);
    if (state) return state;

    const { publicClient } = this.getClients(walletAddress);
    const chainNonce = await publicClient.getTransactionCount({
      address: walletAddress as Address,
    });
    const lastConfirmed = chainNonce - 1;

    const newState: WalletState = {
      pendingNonce: chainNonce,
      submittedNonce: lastConfirmed,
      confirmedNonce: lastConfirmed,
    };

    await this.ctx.storage.put(STATE_KEY, newState);
    return newState;
  }

  private async processNextPendingTx(walletAddress: string): Promise<void> {
    const { walletClient, publicClient } = this.getClients(walletAddress);
    const maxSubmitted = this.env.MAX_SUBMITTED
      ? parseInt(this.env.MAX_SUBMITTED)
      : DEFAULT_MAX_SUBMITTED;

    const state = await this.getOrInitState(walletAddress);

    // Step 1: Check chain for confirmations
    const chainNonce = await publicClient.getTransactionCount({
      address: walletAddress as Address,
    });
    const lastConfirmedOnChain = chainNonce - 1;

    if (lastConfirmedOnChain > state.confirmedNonce) {
      state.confirmedNonce = lastConfirmedOnChain;
    }

    // Step 2: Submit new txs up to MAX_SUBMITTED in flight
    const inFlight = state.submittedNonce - state.confirmedNonce;
    const canSubmit = Math.max(0, maxSubmitted - inFlight);
    const lastNonceToSubmit = Math.min(
      state.submittedNonce + canSubmit,
      state.pendingNonce - 1,
    );

    for (
      let nonce = state.submittedNonce + 1;
      nonce <= lastNonceToSubmit;
      nonce++
    ) {
      const tx = await this.ctx.storage.get<StoredTx>(`${TX_PREFIX}${nonce}`);
      if (!tx) continue;

      try {
        const hash = await walletClient.sendTransaction({
          to: tx.params.to,
          data: tx.params.data,
          value: tx.params.value ? BigInt(tx.params.value) : undefined,
          gas: tx.params.gas ? BigInt(tx.params.gas) : undefined,
          nonce: tx.nonce,
        });

        tx.hash = hash;
        await this.ctx.storage.put(`${TX_PREFIX}${nonce}`, tx);
        state.submittedNonce = nonce;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`Error submitting txn on nonce ${nonce}`, err);

        if (this.isRetriableError(errMsg)) {
          // Retriable error - break and try again next alarm
          break;
        } else {
          // Non-retriable error - skip this tx and continue
          console.log(`Skipping nonce ${nonce} due to non-retriable error`);
          const hash = await this.skipNonce(walletAddress, nonce);
          if (hash == "0x") {
            break;
          }
          tx.hash = hash;
          tx.error = `skipped: ${errMsg}`;
          await this.ctx.storage.put(`${TX_PREFIX}${nonce}`, tx);
          state.submittedNonce = nonce;
        }
      }
    }

    // Save state
    await this.ctx.storage.put(STATE_KEY, state);

    // Reschedule if there's still work to do
    if (state.pendingNonce - 1 !== state.confirmedNonce) {
      await this.ensureAlarmScheduled(ALARM_INTERVAL_MS);
    }
  }

  private async ensureAlarmScheduled(interval: number): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + interval);
    }
  }

  private isRetriableError(errMsg: string): boolean {
    const retriablePatterns = [
      // Network connectivity issues
      /timeout/i, // Request timed out
      /etimedout/i, // Connection timed out
      /econnreset/i, // Connection reset by peer
      /econnrefused/i, // Connection refused by server
      /enotfound/i, // DNS lookup failed
      /socket hang up/i, // Connection closed unexpectedly

      // Rate limiting
      /429/, // HTTP 429 Too Many Requests
      /too many requests/i, // Rate limit exceeded
      /rate limit/i, // Generic rate limiting

      // RPC node issues
      /503/, // HTTP 503 Service Unavailable
      /502/, // HTTP 502 Bad Gateway
      /service unavailable/i, // Node temporarily down
      /header not found/i, // Node is syncing
      /missing trie node/i, // Node is pruning or syncing

      // Mempool issues
      /already known/i, // Tx already in mempool (actually ok, treat as success)
      /txpool.*full/i, // Node mempool at capacity

      // Gas price issues (can retry with higher gas)
      /underpriced/i, // Gas price too low to replace existing tx
      /less than block base fee/i, // Gas price below current base fee
    ];

    return retriablePatterns.some((p) => p.test(errMsg));
  }
}
