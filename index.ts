#!/usr/bin/env node
/**
 * FXFunds Stablecoin Payments Bot
 * Read-only payment verification for USDT on ERC20, TRC20 and TON.
 * Matches observed transactions to payment requests, tracks confirmations,
 * blocks duplicate credits and keeps an exportable payment ledger.
 * No private keys, no signing, no fund transfers.
 * Built by FXFunds — https://fxfunds.com/
 */

export type Network = "erc20" | "trc20" | "ton";
export type PaymentStatus = "pending" | "detected" | "confirming" | "confirmed" | "failed";

export interface PaymentRequest {
  paymentId: string;
  network: Network;
  token: string;          // e.g. "USDT"
  address: string;        // wallet that should receive the payment
  amount: number;         // expected amount
  requiredConfirmations?: number; // overrides the network default
  tolerance?: number;     // allowed shortfall, default 0
}

export interface ObservedTransaction {
  txHash: string;
  network: Network;
  token: string;
  toAddress: string;
  amount: number;
  confirmations: number;
}

export interface PaymentResult {
  paymentId: string;
  status: PaymentStatus;
  txHash: string | null;
  confirmations: number;
  requiredConfirmations: number;
  reason: string;
  checkedAt: string;
}

export type PaymentEvent = "detected" | "confirmed" | "failed";
export type Notifier = (event: PaymentEvent, result: PaymentResult) => void;

interface NetworkProfile {
  label: string;
  addressPattern: RegExp;
  hashPattern: RegExp;
  defaultConfirmations: number;
  caseInsensitiveAddress: boolean;
}

export const NETWORKS: Record<Network, NetworkProfile> = {
  erc20: {
    label: "Ethereum (ERC20)",
    addressPattern: /^0x[a-fA-F0-9]{40}$/,
    hashPattern: /^0x[a-fA-F0-9]{64}$/,
    defaultConfirmations: 12,
    caseInsensitiveAddress: true,
  },
  trc20: {
    label: "Tron (TRC20)",
    addressPattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    hashPattern: /^[a-fA-F0-9]{64}$/,
    defaultConfirmations: 19,
    caseInsensitiveAddress: false,
  },
  ton: {
    label: "TON",
    addressPattern: /^([EU]Q[A-Za-z0-9_-]{46}|-?\d:[a-fA-F0-9]{64})$/,
    hashPattern: /^([a-fA-F0-9]{64}|[A-Za-z0-9+/_-]{43}=?)$/,
    defaultConfirmations: 1,
    caseInsensitiveAddress: false,
  },
};

function sameAddress(network: Network, a: string, b: string): boolean {
  return NETWORKS[network].caseInsensitiveAddress ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Verify one payment request against an observed transaction (or none yet). */
export function verifyPayment(
  req: PaymentRequest,
  tx: ObservedTransaction | null,
  processedHashes: Set<string> = new Set(),
  now: Date = new Date()
): PaymentResult {
  const profile = NETWORKS[req.network];
  if (!profile) throw new Error(`Unsupported network: ${req.network}. Use erc20, trc20 or ton.`);
  const required = req.requiredConfirmations ?? profile.defaultConfirmations;
  const base = { paymentId: req.paymentId, requiredConfirmations: required, checkedAt: now.toISOString() };
  const fail = (reason: string): PaymentResult => ({
    ...base, status: "failed", txHash: tx ? tx.txHash : null, confirmations: tx ? tx.confirmations : 0, reason,
  });

  if (!profile.addressPattern.test(req.address)) return fail("Payment address format does not match the network.");
  if (!tx) return { ...base, status: "pending", txHash: null, confirmations: 0, reason: "No matching transaction observed yet." };

  if (tx.network !== req.network) return fail(`Wrong network: expected ${req.network}, got ${tx.network}.`);
  if (!profile.hashPattern.test(tx.txHash)) return fail("Transaction hash format does not match the network.");
  if (processedHashes.has(tx.txHash.toLowerCase())) return fail("Duplicate: transaction hash already credited.");
  if (tx.token.toUpperCase() !== req.token.toUpperCase()) return fail(`Wrong token: expected ${req.token}, got ${tx.token}.`);
  if (!sameAddress(req.network, tx.toAddress, req.address)) return fail("Destination address does not match the payment request.");

  const shortfall = round6(req.amount - tx.amount);
  if (shortfall > (req.tolerance ?? 0)) return fail(`Underpaid by ${shortfall} ${req.token}.`);

  const overpaid = round6(tx.amount - req.amount);
  const extra = overpaid > 0 ? ` Overpaid by ${overpaid} ${req.token}.` : "";

  if (tx.confirmations <= 0)
    return { ...base, status: "detected", txHash: tx.txHash, confirmations: 0, reason: "Transaction seen, awaiting first confirmation." + extra };
  if (tx.confirmations < required)
    return { ...base, status: "confirming", txHash: tx.txHash, confirmations: tx.confirmations,
      reason: `${tx.confirmations}/${required} confirmations.` + extra };
  return { ...base, status: "confirmed", txHash: tx.txHash, confirmations: tx.confirmations, reason: "Payment verified." + extra };
}

/** Keeps payment history, blocks duplicate credits and fires notifications. */
export class PaymentLedger {
  private records = new Map<string, PaymentResult>();
  private credited = new Set<string>();

  constructor(private notify?: Notifier) {}

  process(req: PaymentRequest, tx: ObservedTransaction | null, now: Date = new Date()): PaymentResult {
    const previous = this.records.get(req.paymentId);
    if (previous && previous.status === "confirmed") return previous;

    const seen = new Set(this.credited);
    if (tx && previous && previous.txHash === tx.txHash) seen.delete(tx.txHash.toLowerCase());
    const result = verifyPayment(req, tx, seen, now);
    this.records.set(req.paymentId, result);

    if (result.status === "confirmed" && result.txHash) this.credited.add(result.txHash.toLowerCase());
    if (this.notify && result.status !== previous?.status) {
      if (result.status === "detected" || result.status === "confirmed" || result.status === "failed")
        this.notify(result.status, result);
    }
    return result;
  }

  history(): PaymentResult[] {
    return [...this.records.values()];
  }

  toJSON(): string {
    return JSON.stringify(this.history(), null, 2);
  }

  toCSV(): string {
    const header = "payment_id,status,tx_hash,confirmations,required_confirmations,reason,checked_at";
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = this.history().map((r) =>
      [r.paymentId, r.status, r.txHash ?? "", r.confirmations, r.requiredConfirmations, esc(r.reason), r.checkedAt].join(",")
    );
    return [header, ...rows].join("\n");
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith("--") ? (i++, next) : "true";
    }
  }
  return out;
}

function printResult(r: PaymentResult): void {
  console.log(`  ${r.paymentId.padEnd(10)} ${r.status.toUpperCase().padEnd(11)} ${r.reason}`);
}

function demo(): void {
  const ledger = new PaymentLedger((event, r) => console.log(`  [notify] ${event} → ${r.paymentId}`));
  const addr = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
  const hash = "a3f1c9e2b7d84f60c1e5a9b3d7f2e8c4a6b0d9e3f7c1a5b8e2d6f0c4a9b3e7d1";
  const req: PaymentRequest = { paymentId: "INV-1001", network: "trc20", token: "USDT", address: addr, amount: 250 };
  const tx = (confirmations: number): ObservedTransaction =>
    ({ txHash: hash, network: "trc20", token: "USDT", toAddress: addr, amount: 250, confirmations });

  console.log("\nFXFunds Stablecoin Payments Bot — demo");
  console.log("=".repeat(60));
  printResult(ledger.process(req, null));
  printResult(ledger.process(req, tx(0)));
  printResult(ledger.process(req, tx(7)));
  printResult(ledger.process(req, tx(19)));
  printResult(ledger.process({ ...req, paymentId: "INV-1002" }, tx(30)));
  console.log("\nLedger (CSV):\n" + ledger.toCSV());
  console.log("\nRead-only verification. Built by FXFunds — https://fxfunds.com/\n");
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  if (!a.address) { demo(); return; }

  const network = (a.network ?? "trc20") as Network;
  const token = a.token ?? "USDT";
  const req: PaymentRequest = {
    paymentId: a.id ?? "PAYMENT",
    network,
    token,
    address: a.address,
    amount: Number(a.amount ?? 0),
    requiredConfirmations: a.required !== undefined ? Number(a.required) : undefined,
    tolerance: a.tolerance !== undefined ? Number(a.tolerance) : undefined,
  };
  const tx: ObservedTransaction | null = a.hash
    ? {
        txHash: a.hash,
        network: (a["tx-network"] ?? network) as Network,
        token: a["tx-token"] ?? token,
        toAddress: a.to ?? a.address,
        amount: Number(a["tx-amount"] ?? a.amount ?? 0),
        confirmations: Number(a.confirmations ?? 0),
      }
    : null;

  const r = verifyPayment(req, tx);
  if (a.json) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log("\nFXFunds Stablecoin Payments Bot");
  console.log("=".repeat(60));
  console.log(`Network:        ${NETWORKS[network].label}`);
  console.log(`Payment:        ${req.paymentId} — ${req.amount} ${token} to ${req.address}`);
  console.log(`Transaction:    ${r.txHash ?? "(none)"}`);
  console.log(`Confirmations:  ${r.confirmations}/${r.requiredConfirmations}`);
  console.log(`Status:         ${r.status.toUpperCase()}`);
  console.log(`Reason:         ${r.reason}`);
  console.log("\nRead-only verification. Built by FXFunds — https://fxfunds.com/\n");
}

if (require.main === module) main();
