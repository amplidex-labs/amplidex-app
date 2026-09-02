import { rpc } from "@stellar/stellar-sdk";

export type SendTransactionResult = {
  hash: string;
  status: string;
};

export type WaitTransactionFn = (hash: string) => Promise<rpc.Api.GetTransactionResponse>;
export type Sleep = (ms: number) => Promise<void>;

export type TransactionInvocationOutcome =
  | {
      type: "success";
      hash: string;
      returnValue: rpc.Api.GetTransactionResponse["returnValue"] | null;
    }
  | { type: "failed"; error: string }
  | { type: "submissionError"; error: string }
  | { type: "timeout"; error: string };

export async function waitForTransactionResult(
  txHash: string,
  attempts = 30,
  intervalMs = 1500,
  getTransaction: WaitTransactionFn,
  sleep: Sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<rpc.Api.GetTransactionResponse | null> {
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    try {
      const result = await getTransaction(txHash);
      if (
        result.status === rpc.Api.GetTransactionStatus.SUCCESS ||
        result.status === rpc.Api.GetTransactionStatus.FAILED
      ) {
        return result;
      }
    } catch (error) {
      // If the RPC returns temporary lookup/network errors, keep polling.
      console.warn("Transaction lookup failed during confirmation polling:", error);
    }
  }
  return null;
}

export function resolveTransactionInvocation(
  sent: SendTransactionResult,
  result: rpc.Api.GetTransactionResponse | null
): TransactionInvocationOutcome {
  if (result?.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      type: "success",
      hash: sent.hash,
      returnValue: result.returnValue ? result.returnValue : null,
    };
  }
  if (result?.status === rpc.Api.GetTransactionStatus.FAILED) {
    return { type: "failed", error: `Transaction failed: ${sent.hash}` };
  }
  if (sent.status === "ERROR") {
    return {
      type: "submissionError",
      error: `Submission status was ${sent.status} and could not be confirmed yet; check explorer for this transaction: ${sent.hash}`,
    };
  }
  return { type: "timeout", error: `Transaction submitted but timed out while waiting: ${sent.hash}` };
}
