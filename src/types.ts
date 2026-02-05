import type { Hex } from "viem";

export type TxStatus = "pending" | "submitted" | "confirmed";

export interface TxParams {
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
}

export interface StoredTx {
  nonce: number;
  params: TxParams;
  hash?: Hex;
  createdAt: number;
  error?: string;
}

export interface SubmitTxRequest {
  to: Hex;
  value?: string;
  data?: Hex;
  gasLimit?: string;
}
