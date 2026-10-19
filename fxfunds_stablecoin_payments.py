#!/usr/bin/env python3
"""
FXFunds Stablecoin Payments Bot (Python)
Read-only payment verification for USDT on ERC20, TRC20 and TON.
Matches observed transactions to payment requests, tracks confirmations,
blocks duplicate credits and keeps an exportable payment ledger.
No private keys, no signing, no fund transfers.
Built by FXFunds — https://fxfunds.com/
"""

__version__ = "1.0.0"

import argparse
import csv
import io
import json
import re
from dataclasses import dataclass, asdict, replace
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Set

NETWORKS: Dict[str, dict] = {
    "erc20": {
        "label": "Ethereum (ERC20)",
        "address": re.compile(r"^0x[a-fA-F0-9]{40}$"),
        "hash": re.compile(r"^0x[a-fA-F0-9]{64}$"),
        "default_confirmations": 12,
        "case_insensitive_address": True,
    },
    "trc20": {
        "label": "Tron (TRC20)",
        "address": re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"),
        "hash": re.compile(r"^[a-fA-F0-9]{64}$"),
        "default_confirmations": 19,
        "case_insensitive_address": False,
    },
    "ton": {
        "label": "TON",
        "address": re.compile(r"^([EU]Q[A-Za-z0-9_-]{46}|-?\d:[a-fA-F0-9]{64})$"),
        "hash": re.compile(r"^([a-fA-F0-9]{64}|[A-Za-z0-9+/_-]{43}=?)$"),
        "default_confirmations": 1,
        "case_insensitive_address": False,
    },
}


@dataclass
class PaymentRequest:
    payment_id: str
    network: str
    token: str
    address: str
    amount: float
    required_confirmations: Optional[int] = None
    tolerance: float = 0.0


@dataclass
class ObservedTransaction:
    tx_hash: str
    network: str
    token: str
    to_address: str
    amount: float
    confirmations: int


@dataclass
class PaymentResult:
    payment_id: str
    status: str
    tx_hash: Optional[str]
    confirmations: int
    required_confirmations: int
    reason: str
    checked_at: str


Notifier = Callable[[str, PaymentResult], None]


def _same_address(network: str, a: str, b: str) -> bool:
    if NETWORKS[network]["case_insensitive_address"]:
        return a.lower() == b.lower()
    return a == b


def _fmt(n: float) -> str:
    n = round(n, 6)
    return str(int(n)) if n == int(n) else str(n)


def verify_payment(
    req: PaymentRequest,
    tx: Optional[ObservedTransaction],
    processed_hashes: Optional[Set[str]] = None,
    now: Optional[datetime] = None,
) -> PaymentResult:
    """Verify one payment request against an observed transaction (or none yet)."""
    profile = NETWORKS.get(req.network)
    if profile is None:
        raise ValueError(f"Unsupported network: {req.network}. Use erc20, trc20 or ton.")
    processed_hashes = processed_hashes or set()
    required = req.required_confirmations if req.required_confirmations is not None else profile["default_confirmations"]
    checked_at = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def result(status: str, reason: str, tx_hash=None, conf=0) -> PaymentResult:
        return PaymentResult(req.payment_id, status, tx_hash, conf, required, reason, checked_at)

    def fail(reason: str) -> PaymentResult:
        return result("failed", reason, tx.tx_hash if tx else None, tx.confirmations if tx else 0)

    if not profile["address"].match(req.address):
        return fail("Payment address format does not match the network.")
    if tx is None:
        return result("pending", "No matching transaction observed yet.")

    if tx.network != req.network:
        return fail(f"Wrong network: expected {req.network}, got {tx.network}.")
    if not profile["hash"].match(tx.tx_hash):
        return fail("Transaction hash format does not match the network.")
    if tx.tx_hash.lower() in processed_hashes:
        return fail("Duplicate: transaction hash already credited.")
    if tx.token.upper() != req.token.upper():
        return fail(f"Wrong token: expected {req.token}, got {tx.token}.")
    if not _same_address(req.network, tx.to_address, req.address):
        return fail("Destination address does not match the payment request.")

    shortfall = round(req.amount - tx.amount, 6)
    if shortfall > (req.tolerance or 0):
        return fail(f"Underpaid by {_fmt(shortfall)} {req.token}.")

    overpaid = round(tx.amount - req.amount, 6)
    extra = f" Overpaid by {_fmt(overpaid)} {req.token}." if overpaid > 0 else ""

    if tx.confirmations <= 0:
        return result("detected", "Transaction seen, awaiting first confirmation." + extra, tx.tx_hash, 0)
    if tx.confirmations < required:
        return result("confirming", f"{tx.confirmations}/{required} confirmations." + extra, tx.tx_hash, tx.confirmations)
    return result("confirmed", "Payment verified." + extra, tx.tx_hash, tx.confirmations)


class PaymentLedger:
    """Keeps payment history, blocks duplicate credits and fires notifications."""

    def __init__(self, notify: Optional[Notifier] = None):
        self._records: Dict[str, PaymentResult] = {}
        self._credited: Set[str] = set()
        self._notify = notify

    def process(self, req: PaymentRequest, tx: Optional[ObservedTransaction],
                now: Optional[datetime] = None) -> PaymentResult:
        previous = self._records.get(req.payment_id)
        if previous and previous.status == "confirmed":
            return previous

        seen = set(self._credited)
        if tx and previous and previous.tx_hash == tx.tx_hash:
            seen.discard(tx.tx_hash.lower())
        res = verify_payment(req, tx, seen, now)
        self._records[req.payment_id] = res

        if res.status == "confirmed" and res.tx_hash:
            self._credited.add(res.tx_hash.lower())
        if self._notify and (previous is None or res.status != previous.status):
            if res.status in ("detected", "confirmed", "failed"):
                self._notify(res.status, res)
        return res

    def history(self) -> List[PaymentResult]:
        return list(self._records.values())

    def to_json(self) -> str:
        return json.dumps([asdict(r) for r in self.history()], indent=2)

    def to_csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["payment_id", "status", "tx_hash", "confirmations", "required_confirmations", "reason", "checked_at"])
        for r in self.history():
            w.writerow([r.payment_id, r.status, r.tx_hash or "", r.confirmations,
                        r.required_confirmations, r.reason, r.checked_at])
        return buf.getvalue().rstrip("\n")


def _print(r: PaymentResult) -> None:
    print(f"  {r.payment_id:<10} {r.status.upper():<11} {r.reason}")


def demo() -> None:
    ledger = PaymentLedger(lambda event, r: print(f"  [notify] {event} → {r.payment_id}"))
    addr = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"
    tx_hash = "a3f1c9e2b7d84f60c1e5a9b3d7f2e8c4a6b0d9e3f7c1a5b8e2d6f0c4a9b3e7d1"
    req = PaymentRequest("INV-1001", "trc20", "USDT", addr, 250)

    def tx(conf: int) -> ObservedTransaction:
        return ObservedTransaction(tx_hash, "trc20", "USDT", addr, 250, conf)

    print("\nFXFunds Stablecoin Payments Bot — demo")
    print("=" * 60)
    _print(ledger.process(req, None))
    _print(ledger.process(req, tx(0)))
    _print(ledger.process(req, tx(7)))
    _print(ledger.process(req, tx(19)))
    _print(ledger.process(replace(req, payment_id="INV-1002"), tx(30)))
    print("\nLedger (CSV):\n" + ledger.to_csv())
    print("\nRead-only verification. Built by FXFunds — https://fxfunds.com/\n")


def main() -> None:
    p = argparse.ArgumentParser(description="FXFunds Stablecoin Payments Bot — read-only payment verification")
    p.add_argument("--network", default="trc20", choices=NETWORKS.keys())
    p.add_argument("--token", default="USDT")
    p.add_argument("--id", default="PAYMENT", help="Payment / invoice ID")
    p.add_argument("--address", help="Wallet that should receive the payment")
    p.add_argument("--amount", type=float, default=0, help="Expected amount")
    p.add_argument("--required", type=int, help="Required confirmations (default: network default)")
    p.add_argument("--tolerance", type=float, default=0.0, help="Allowed shortfall")
    p.add_argument("--hash", help="Observed transaction hash")
    p.add_argument("--to", help="Observed destination address (default: --address)")
    p.add_argument("--tx-amount", type=float, help="Observed amount (default: --amount)")
    p.add_argument("--tx-token", help="Observed token (default: --token)")
    p.add_argument("--tx-network", choices=NETWORKS.keys(), help="Observed network (default: --network)")
    p.add_argument("--confirmations", type=int, default=0)
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    if not a.address:
        demo()
        return

    req = PaymentRequest(a.id, a.network, a.token, a.address, a.amount, a.required, a.tolerance)
    tx = ObservedTransaction(
        a.hash, a.tx_network or a.network, a.tx_token or a.token, a.to or a.address,
        a.tx_amount if a.tx_amount is not None else a.amount, a.confirmations,
    ) if a.hash else None

    r = verify_payment(req, tx)
    if a.json:
        print(json.dumps(asdict(r), indent=2))
        return
    print("\nFXFunds Stablecoin Payments Bot")
    print("=" * 60)
    print(f"Network:        {NETWORKS[a.network]['label']}")
    print(f"Payment:        {req.payment_id} — {_fmt(req.amount)} {a.token} to {req.address}")
    print(f"Transaction:    {r.tx_hash or '(none)'}")
    print(f"Confirmations:  {r.confirmations}/{r.required_confirmations}")
    print(f"Status:         {r.status.upper()}")
    print(f"Reason:         {r.reason}")
    print("\nRead-only verification. Built by FXFunds — https://fxfunds.com/\n")


if __name__ == "__main__":
    main()
