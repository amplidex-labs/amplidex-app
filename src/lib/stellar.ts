import {
  Address,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  rpc,
  Account,
} from "@stellar/stellar-sdk";

import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit-tech/stellar-wallets-kit/modules/utils";
import { config } from "./config";

let initialized = false;
export function initWalletKit() {
  if (initialized) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: config.network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET,
  });
  initialized = true;
}

export async function connectWallet(): Promise<string> {
  initWalletKit();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export async function restoreWallet(): Promise<string | null> {
  try {
    initWalletKit();
    return (await StellarWalletsKit.getAddress()).address;
  } catch {
    return null;
  }
}

const server = new rpc.Server(config.rpcUrl);

export const sc = {
  address: (v: string) => new Address(v).toScVal(),
  i128: (v: bigint) => nativeToScVal(v, { type: "i128" }),
  u32: (v: number) => nativeToScVal(v, { type: "u32" }),
  u64: (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" }),
  bool: (v: boolean) => nativeToScVal(v, { type: "bool" }),
  optionU32: (v: number | null) =>
    v === null ? xdr.ScVal.scvVoid() : nativeToScVal(v, { type: "u32" }),
  side: (v: "Long" | "Short") => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(v)]),
};

const ERROR_KEYS = [
  "message",
  "error",
  "reason",
  "detail",
  "details",
  "description",
] as const;

/** Convert wallet, RPC, SDK and contract failures into safe user-facing text. */
export function getErrorMessage(error: unknown): string {
  const seen = new WeakSet<object>();

  const read = (value: unknown, depth = 0): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "bigint") return value.toString();
    if (depth > 4) return "";

    if (value instanceof Error) {
      const message = read(value.message, depth + 1);
      if (message && message !== "[object Object]") return message;
      const cause = read(value.cause, depth + 1);
      if (cause) return cause;
    }

    if (typeof value === "object") {
      if (seen.has(value)) return "";
      seen.add(value);
      const record = value as Record<string, unknown>;

      for (const key of ERROR_KEYS) {
        const message = read(record[key], depth + 1);
        if (message && message !== "[object Object]") return message;
      }

      const code = read(record.code, depth + 1);
      const status = read(record.status, depth + 1);
      if (code || status) return [code, status].filter(Boolean).join(" · ");

      try {
        const json = JSON.stringify(value, (_key, nested) =>
          typeof nested === "bigint" ? nested.toString() : nested
        );
        if (json && json !== "{}") return json;
      } catch {
        return "";
      }
    }

    return "";
  };

  const message = read(error).replace(/^Error:\s*/i, "").trim();
  if (!message || message === "[object Object]") {
    return "Something went wrong. Please review the transaction and try again.";
  }

  if (/user rejected|request rejected|declined|cancelled by user/i.test(message)) {
    return "The request was cancelled in your wallet.";
  }

  return message.length > 420 ? `${message.slice(0, 417)}…` : message;
}

export async function readContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
  source?: string
) {
  if (!contractId) throw new Error("Missing contract ID in .env");
  const sourceKey =
    source || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const account = source
    ? await server.getAccount(sourceKey)
    : new Account(sourceKey, "0");
  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: config.passphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(getErrorMessage(sim.error));
  if (!sim.result) return null;
  return scValToNative(sim.result.retval);
}

export async function invokeContract(
  address: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
) {
  if (!address) throw new Error("Connect a wallet first");
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: config.passphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(180)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(getErrorMessage(simulation.error));
  }
  const prepared = rpc.assembleTransaction(tx, simulation).build();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(
    prepared.toXDR(),
    {
      networkPassphrase: config.passphrase,
      address,
    }
  );
  const signed = TransactionBuilder.fromXDR(
    signedTxXdr,
    config.passphrase
  ) as Transaction;
  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR")
    throw new Error(
      `Submission failed: ${sent.errorResult?.toXDR("base64") || sent.status}`
    );
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const result = await server.getTransaction(sent.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        hash: sent.hash,
        result: result.returnValue ? scValToNative(result.returnValue) : null,
      };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED)
      throw new Error(`Transaction failed: ${sent.hash}`);
  }
  throw new Error(
    `Transaction submitted but timed out while waiting: ${sent.hash}`
  );
}

export async function safeRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(getErrorMessage(e));
    return null;
  }
}
