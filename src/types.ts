import type { Hex } from "viem";

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
  /** Raw hex-encoded calldata */
  data?: Hex;
  /** Human-readable function signature, e.g. "mint(address,uint256)" */
  abi?: string;
  /** Arguments for the function call */
  args?: unknown[];
  gasLimit?: string;
}
