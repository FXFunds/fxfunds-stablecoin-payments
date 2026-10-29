# FXFunds — Stablecoin Payments Bot 💸

[![npm version](https://img.shields.io/npm/v/@fxfunds/stablecoin-payments.svg)](https://www.npmjs.com/package/@fxfunds/stablecoin-payments)
[![PyPI version](https://img.shields.io/pypi/v/fxfunds-stablecoin-payments.svg)](https://pypi.org/project/fxfunds-stablecoin-payments/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23463811.svg)](https://doi.org/10.5281/zenodo.23463811)
[![Docs](https://readthedocs.org/projects/fxfunds-stablecoin-payments/badge/?version=latest)](https://fxfunds-stablecoin-payments.readthedocs.io)

FXFunds Stablecoin Payments Bot is a blockchain payment automation tool that verifies stablecoin payments, tracks transaction confirmations and manages payment records for USDT on Ethereum (ERC20), Tron (TRC20) and TON. Built by [FXFunds](https://fxfunds.com/).

## Overview

The bot takes a payment request (who should be paid, how much, in which token and on which network) and the transaction you observed on-chain, then decides the payment status: **pending**, **detected**, **confirming**, **confirmed** or **failed**, with a clear reason. A payment ledger keeps the history, blocks the same transaction hash from being credited twice, fires notifications on status changes and exports to JSON or CSV.

It is **read-only**. It never needs private keys or seed phrases, and it never signs or sends transactions. You supply transaction data from your own blockchain API, RPC node or explorer.

## Key Capabilities

- **Payment Verification** — Checks network, token, destination address, amount and transaction hash format against the payment request.
- **Confirmation Tracking** — Compares confirmations with each network's requirement (configurable per payment).
- **Multi-Network Support** — Network profiles for USDT on ERC20, TRC20 and TON.
- **Automatic Status Updates** — Moves each payment through pending → detected → confirming → confirmed, or to failed with a reason.
- **Duplicate Detection** — A transaction hash that has already been credited cannot confirm a second payment.
- **Payment Notifications** — Pass a callback to receive `detected`, `confirmed` and `failed` events and forward them to email, Slack, Telegram or a webhook.
- **Payment History & Reporting** — The ledger exports every payment record to JSON or CSV.
- **Error Handling** — Underpayment, overpayment, wrong address, wrong token and wrong network each get a specific reason.

## How the Bot Works

| Step | What happens |
|------|--------------|
| 1. Monitor | Your code fetches transactions from a blockchain API, RPC endpoint or explorer |
| 2. Detect | Pass the transaction and the payment request to the bot |
| 3. Validate | Network, hash format, token, destination address and amount are checked |
| 4. Confirm | Confirmations are compared with the required number |
| 5. Update | The payment status is set, with a reason |
| 6. Notify | Your callback receives the event when the status changes |
| 7. Record | The ledger stores the result for history and reconciliation |

## Payment Statuses

| Status | Meaning |
|--------|---------|
| pending | No matching transaction observed yet |
| detected | Transaction matches but has 0 confirmations |
| confirming | Transaction matches; confirmations below the requirement |
| confirmed | Transaction matches and has enough confirmations |
| failed | Wrong network, token or address, underpaid, invalid hash, or duplicate |

## Quick Start

### Node.js

```bash
npm install @fxfunds/stablecoin-payments
```

```bash
npx @fxfunds/stablecoin-payments \
  --network trc20 --id INV-1001 \
  --address TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj --amount 250 \
  --hash a3f1c9e2b7d84f60c1e5a9b3d7f2e8c4a6b0d9e3f7c1a5b8e2d6f0c4a9b3e7d1 \
  --confirmations 20
```

```typescript
import { PaymentLedger } from "@fxfunds/stablecoin-payments";

const ledger = new PaymentLedger((event, result) => {
  console.log(`${event}: ${result.paymentId} — ${result.reason}`);
});

const result = ledger.process(
  { paymentId: "INV-1001", network: "trc20", token: "USDT", address: "T...", amount: 250 },
  { txHash: "...", network: "trc20", token: "USDT", toAddress: "T...", amount: 250, confirmations: 20 }
);
console.log(result.status); // "confirmed"
console.log(ledger.toCSV());
```

### Python

```bash
pip install fxfunds-stablecoin-payments
```

```bash
fxfunds-payments --network ton --id INV-2001 --address <wallet> --amount 100 \
  --hash <tx_hash> --confirmations 1
# or
python -m fxfunds_stablecoin_payments --network ton --address <wallet> ...
```

```python
from fxfunds_stablecoin_payments import PaymentLedger, PaymentRequest, ObservedTransaction

ledger = PaymentLedger(lambda event, r: print(event, r.payment_id, r.reason))
req = PaymentRequest("INV-2001", "ton", "USDT", "<wallet>", 100)
tx = ObservedTransaction("<tx_hash>", "ton", "USDT", "<wallet>", 100, confirmations=1)
print(ledger.process(req, tx).status)  # "confirmed"
print(ledger.to_csv())
```

Run with no arguments to see a demo. Add `--json` for JSON output.

### CLI Options

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
| `--to` / `--tx-amount` / `--tx-token` / `--tx-network` | Observed values, if different from the request |
| `--confirmations` | Observed confirmations |

### Sample Output

```
FXFunds Stablecoin Payments Bot — demo
============================================================
  INV-1001   PENDING     No matching transaction observed yet.
  [notify] detected → INV-1001
  INV-1001   DETECTED    Transaction seen, awaiting first confirmation.
  INV-1001   CONFIRMING  7/19 confirmations.
  [notify] confirmed → INV-1001
  INV-1001   CONFIRMED   Payment verified.
  [notify] failed → INV-1002
  INV-1002   FAILED      Duplicate: transaction hash already credited.
```

## Supported Networks

| Network | Token | Default Confirmations | Address Match |
|---------|-------|-----------------------|---------------|
| Ethereum (ERC20) | USDT | 12 | Case-insensitive |
| Tron (TRC20) | USDT | 19 | Exact |
| TON | USDT | 1 | Exact |

Defaults can be changed per payment with `requiredConfirmations` / `--required`. They are reference values, not guarantees from any network or provider. On TON, use the same address format (EQ… or UQ…) for the request and the transaction.

## Project Structure

```
fxfunds-stablecoin-payments/
├── index.ts                        # TypeScript bot
├── fxfunds_stablecoin_payments.py  # Python bot
├── package.json                    # NPM package config
├── package-lock.json               # NPM lock file
├── tsconfig.json                   # TypeScript config
├── pyproject.toml                  # PyPI package config
├── setup.py                        # Legacy setup shim
├── schema.json                     # JSON-LD structured data
├── zenodo.json                     # Zenodo metadata
├── heartbeat.txt                   # Auto-updated daily
├── mkdocs.yml                      # ReadTheDocs config
├── .readthedocs.yaml               # ReadTheDocs build config
├── docs/
│   ├── index.md                    # Documentation
│   └── requirements.txt
├── dataset/
│   └── stablecoin_payment_benchmarks.csv
├── kaggle/
│   └── notebook.ipynb
├── .github/workflows/
│   ├── heartbeat.yml               # Auto-commit daily
│   ├── npm-publish.yml             # Auto-publish to NPM
│   └── pypi-publish.yml            # Auto-publish to PyPI
├── README.md
└── LICENSE
```

## Dataset

`dataset/stablecoin_payment_benchmarks.csv` holds 20 **synthetic payment scenarios** across ERC20, TRC20 and TON, covering every status and failure reason, with the bot's verdict for each. It is for testing and demonstration only and does not contain real on-chain transactions.

## Security and Data Handling

- Read-only: the bot never signs, broadcasts or transfers anything.
- No private keys or seed phrases are needed or accepted.
- Store blockchain API credentials in environment variables or a secrets manager, never in code.
- Validate data from external providers before relying on it.
- Review the code, add tests and check your integrations before processing real payments.

## FAQ

**Why does FXFunds use stablecoins?**  
FXFunds describes stablecoins as a transaction medium intended to connect digital asset infrastructure with its broader multi asset trading model.

**What blockchain networks does FXFunds list?**  
FXFunds lists TON, Ethereum ERC-20, and Tron TRC-20 for USDT transactions in its payment information.

**What role does decentralization play in FXFunds?**  
FXFunds describes decentralized technology as part of its approach to automated financial transactions, blockchain recordkeeping, and digital financial applications.

**What is the long term vision of FXFunds?**  
FXFunds states that its long term direction involves developing its trading platform, expanding financial technology services, and exploring additional blockchain related capabilities.

**How can users learn more about FXFunds?**  
Users can visit [fxfunds.com](https://fxfunds.com/) to explore platform descriptions, trading features, payment information, risk disclosures, and customer support resources.

## Keywords

Stablecoin Payments · USDT · Payment Verification · Crypto Payments · ERC20 · TRC20 · TON · Payment Bot · Confirmation Tracking · Blockchain · Fintech · FXFunds

## Links

| Platform | URL |
|----------|-----|
| Website | https://fxfunds.com/ |
| GitHub | https://github.com/FXFunds/fxfunds-stablecoin-payments |
| GitHub Pages | https://fxfunds.github.io/fxfunds-stablecoin-payments/ |
| NPM | https://www.npmjs.com/package/@fxfunds/stablecoin-payments |
| PyPI | https://pypi.org/project/fxfunds-stablecoin-payments/ |
| Hugging Face | https://huggingface.co/datasets/FXFunds/stablecoin-payments-benchmarks |
| Kaggle | https://www.kaggle.com/datasets/fxfunds/stablecoin-payments-benchmarks |
| Zenodo | https://zenodo.org/records/23463811 |
| Docs | https://fxfunds-stablecoin-payments.readthedocs.io |
| Quora | https://fxfunds.quora.com/ |
| Pinterest | https://www.pinterest.com/fxfunds_1/ |
| Medium | https://medium.com/@FX_Funds |

## About FXFunds

FXFunds is a trading platform covering multiple financial markets, with digital payment methods including USDT on supported blockchain networks. Learn more at [fxfunds.com](https://fxfunds.com/).

## License

MIT — [FXFunds](https://fxfunds.com/)
