# durable-wallets

Manages a pool of Ethereum wallets on Cloudflare Workers using Durable Objects. Handles nonce sequencing, transaction queuing, and automatic error recovery so you can submit transactions without worrying about nonce conflicts or stuck txs.

## How it works

- **Wallet Pool** — Round-robins transactions across wallets, disables low-balance wallets automatically.
- **Wallet DO** — One Durable Object per wallet. Manages nonce state and processes queued transactions on a 2s alarm loop.
- **Nonce management** — Optimistic assignment, tracked through pending → submitted → confirmed.
- **Error recovery** — Retriable errors (timeouts, rate limits) retry next alarm. Non-retriable errors skip the nonce via self-transfer.

## Local dev

```
bun install
cp .dev.vars.example .dev.vars   # add your RPC URL, private keys, and API key
bun run dev
```

## Deploy

Set `CHAIN_ID` in `wrangler.toml` under `[vars]` (defaults to Base Sepolia `84532`).

```
wrangler secret put RPC_URL
wrangler secret put PRIVATE_KEYS
wrangler secret put API_KEY
bun run deploy
```

### Optional config

Set these in `wrangler.toml` `[vars]` to override defaults:

| Variable          | Default           | Description                                             |
| ----------------- | ----------------- | ------------------------------------------------------- |
| `MAX_SUBMITTED`   | `3`               | Max unconfirmed txns per wallet before queuing new ones. Higher values increase throughput but risk more stuck nonces if a tx fails. |
| `POLL_INTERVAL`   | `2000`            | How often (ms) each wallet's alarm fires to submit queued txns and check confirmations. Lower values reduce latency but increase DO requests. |
| `TX_RETENTION`    | `50`              | Number of confirmed txns to keep in storage per wallet. Older records are deleted on each alarm cycle. |
| `MIN_BALANCE_WEI` | `100000000000000` | Wallets below this balance (~0.0001 ETH) are automatically removed from the pool rotation until funded. |

## API

### `POST /pool/send`

All endpoints (except `/health`) require `Authorization: Bearer <API_KEY>`.

Submit a transaction. The pool auto-selects a wallet.

```json
{
  "to": "0x...",
  "abi": "mint(address,uint256)",
  "args": ["0x...", 1]
}
```

Returns `{ nonce, status, wallet }`.

### Other endpoints

- `POST /wallets/:address/send` — Send via a specific wallet
- `POST /wallets/:address/reset` — Clear all wallet state and re-sync nonce from chain (WARNING: drops all queued and in-flight transactions)
- `GET /pool/wallets` — List wallet addresses
- `GET /pool/disabled` — List low-balance wallets
- `GET /wallets/:address/status` — Nonce counters, queue depth
- `GET /wallets/:address/tx/:nonce` — Transaction details (includes `status`: pending/submitted/confirmed/error)
- `GET /health` — Health check

## Support

If this is useful to you: [`0x15AaC`](https://blockscan.com/address/0x15AaC375975D34f3F9d6Ada31702b14eA1248714)
