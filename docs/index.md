# FXFunds Stablecoin Payments Bot

Read-only payment verification for USDT on Ethereum (ERC20), Tron (TRC20) and TON. Built by [FXFunds](https://fxfunds.com/).

## Installation

**Node.js**

```bash
npm install @fxfunds/stablecoin-payments
```

**Python**

```bash
pip install fxfunds-stablecoin-payments
fxfunds-payments
```

## Usage

```bash
npx @fxfunds/stablecoin-payments --network trc20 --id INV-1001 \
  --address <wallet> --amount 250 --hash <tx_hash> --confirmations 20 [--json]
```

| Option | Description |
|--------|-------------|
| `--network` | `erc20`, `trc20` or `ton` |
| `--id` | Payment or invoice ID |
| `--address` | Wallet that should receive the payment |
| `--amount` | Expected amount |
| `--token` | Token symbol (default `USDT`) |
| `--required` | Required confirmations (default: network value) |
| `--tolerance` | Allowed shortfall (default `0`) |
| `--hash` | Observed transaction hash (omit for pending) |
| `--to` | Observed destination address |
| `--tx-amount` | Observed amount |
| `--tx-token` | Observed token |
| `--tx-network` | Observed network |
| `--confirmations` | Observed confirmations |
| `--json` | Print JSON instead of a report |

## API

### `verifyPayment(request, transaction, processedHashes?)`

Checks one payment request against one observed transaction (or `null` if none yet) and returns `paymentId`, `status`, `txHash`, `confirmations`, `requiredConfirmations`, `reason` and `checkedAt`.

### `PaymentLedger(notify?)`

- `process(request, transaction)` — verifies, stores the result and blocks duplicate credits
- `history()` — all payment results
- `toJSON()` / `toCSV()` — export the ledger (Python: `to_json()` / `to_csv()`)
- `notify(event, result)` — optional callback for `detected`, `confirmed` and `failed`

### `NETWORKS`

Network profiles (address pattern, hash pattern, default confirmations, address matching rule).

## Verification Order

1. Payment address format matches the network
2. A transaction exists (otherwise **pending**)
3. Transaction network matches
4. Transaction hash format is valid
5. Hash has not already been credited (duplicate check)
6. Token matches
7. Destination address matches
8. Amount is not below the expected amount minus tolerance
9. Confirmations decide **detected**, **confirming** or **confirmed**

Any failed check returns **failed** with a specific reason.

## Payment Statuses

| Status | Meaning |
|--------|---------|
| pending | No matching transaction observed yet |
| detected | Transaction matches but has 0 confirmations |
| confirming | Confirmations below the requirement |
| confirmed | Payment verified |
| failed | A verification check failed |

## Security

The bot is read-only. It does not need or accept private keys or seed phrases, and it never signs or broadcasts transactions. Review the code, add tests and check your integrations before processing real payments.

## Links

- Website: [fxfunds.com](https://fxfunds.com/)
- GitHub: [FXFunds/fxfunds-stablecoin-payments](https://github.com/FXFunds/fxfunds-stablecoin-payments)
- NPM: [@fxfunds/stablecoin-payments](https://www.npmjs.com/package/@fxfunds/stablecoin-payments)
- PyPI: [fxfunds-stablecoin-payments](https://pypi.org/project/fxfunds-stablecoin-payments/)
- Quora: [fxfunds.quora.com](https://fxfunds.quora.com/)
- Pinterest: [pinterest.com/fxfunds_1](https://www.pinterest.com/fxfunds_1/)
- Medium: [medium.com/@FX_Funds](https://medium.com/@FX_Funds)
