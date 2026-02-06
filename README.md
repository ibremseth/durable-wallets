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

```
wrangler secret put RPC_URL
wrangler secret put PRIVATE_KEYS
wrangler secret put API_KEY
bun run deploy
```

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
- `GET /pool/wallets` — List wallet addresses
- `GET /pool/disabled` — List low-balance wallets
- `GET /wallets/:address/status` — Nonce counters, queue depth
- `GET /wallets/:address/tx/:nonce` — Transaction details
- `GET /health` — Health check

## Support

If this is useful to you: [`0x15AaC`](https://blockscan.com/address/0x15AaC375975D34f3F9d6Ada31702b14eA1248714)
