import { DurableObject } from "cloudflare:workers";
import {
  createPublicClient,
  http,
  extractChain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";

export interface PoolEnv {
  PRIVATE_KEYS: string;
  RPC_URL: string;
  CHAIN_ID: string;
  MIN_BALANCE_WEI?: string;
}

const BALANCE_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_MIN_BALANCE_WEI = "100000000000000"; // 0.0001 ETH
const DISABLED_KEY = "disabledWallets";

export class WalletPoolDurableObject extends DurableObject<PoolEnv> {
  private nextIndex = -1;
  private cachedAddresses: string[] | null = null;
  private cachedDisabledWallets: string[] = ["0x"];

  getAddresses(): string[] {
    if (!this.cachedAddresses) {
      const keys = this.env.PRIVATE_KEYS.split(",").map((k) => k.trim());
      this.cachedAddresses = keys.map((k) =>
        privateKeyToAccount(k as Hex).address.toLowerCase(),
      );
    }
    return this.cachedAddresses;
  }

  async alarm(): Promise<void> {
    await this.checkBalances();
    // Don't reschedule here - let getNextWallet() trigger alarms based on activity
  }

  async getNextWallet(): Promise<string> {
    const addresses = this.getAddresses();
    const disabled = await this.getDisabledWallets();
    const pool = addresses.filter((a) => !disabled.includes(a));

    // Fallback to all addresses if all are disabled
    if (pool.length == 0) {
      throw new Error("No wallets available");
    }

    if (this.nextIndex === -1) {
      this.nextIndex = Math.floor(Math.random() * pool.length);
    }

    const address = pool[this.nextIndex % pool.length];
    this.nextIndex = (this.nextIndex + 1) % pool.length;

    await this.ensureAlarmScheduled();
    return address;
  }

  async getDisabledWallets(): Promise<string[]> {
    if (this.cachedDisabledWallets.at(0) != "0x") {
      return this.cachedDisabledWallets;
    }

    this.cachedDisabledWallets =
      (await this.ctx.storage.get<string[]>(DISABLED_KEY)) ?? [];
    return this.cachedDisabledWallets;
  }

  async refresh(): Promise<{ disabled: string[] }> {
    await this.checkBalances();
    return { disabled: this.cachedDisabledWallets };
  }

  private async checkBalances(): Promise<void> {
    const addresses = this.getAddresses();
    const minBalance = BigInt(
      this.env.MIN_BALANCE_WEI ?? DEFAULT_MIN_BALANCE_WEI,
    );

    const client = createPublicClient({
      chain: extractChain({
        chains: Object.values(chains),
        id: parseInt(this.env.CHAIN_ID),
      }),
      transport: http(this.env.RPC_URL),
    });

    const disabled: string[] = [];

    for (const addr of addresses) {
      try {
        const balance = await client.getBalance({ address: addr as Address });
        if (balance < minBalance) {
          disabled.push(addr);
        }
      } catch (err) {
        console.log(`Error checking balance for ${addr}:`, err);
      }
    }

    await this.ctx.storage.put(DISABLED_KEY, disabled);
    this.cachedDisabledWallets = disabled;

    if (disabled.length > 0) {
      // TODO: Notify owner of low balance
      console.log("WARNING: Wallets with low balance:", disabled);
    }
  }

  private async ensureAlarmScheduled(): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + BALANCE_CHECK_INTERVAL_MS);
    }
  }
}
