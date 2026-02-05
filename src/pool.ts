import { DurableObject } from "cloudflare:workers";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface PoolEnv {
  PRIVATE_KEYS: string;
}

export class WalletPoolDurableObject extends DurableObject<PoolEnv> {
  private nextIndex = -1;
  private cachedAddresses: string[] | null = null;

  getAddresses(): string[] {
    if (!this.cachedAddresses) {
      const keys = this.env.PRIVATE_KEYS.split(",").map((k) => k.trim());
      this.cachedAddresses = keys.map((k) =>
        privateKeyToAccount(k as Hex).address.toLowerCase(),
      );
    }
    return this.cachedAddresses;
  }

  getNextWallet(): string {
    const addresses = this.getAddresses();

    // Initialize to random index on first call
    if (this.nextIndex === -1) {
      this.nextIndex = Math.floor(Math.random() * addresses.length);
    }

    const address = addresses[this.nextIndex];
    this.nextIndex = (this.nextIndex + 1) % addresses.length;
    return address;
  }
}
