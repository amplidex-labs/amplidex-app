import { strict as assert } from "node:assert";
import { rpc } from "@stellar/stellar-sdk";

import {
  resolveTransactionInvocation,
  waitForTransactionResult,
  type SendTransactionResult,
} from "../src/lib/transactionConfirmation";

type TransactionResult = {
  status: string;
  returnValue?: unknown;
};

const run = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
};

const noSleep = async (_ms: number) => {};

await run("returns success outcome", async () => {
  const sent: SendTransactionResult = { hash: "tx-success", status: "PENDING" };
  const outcome = resolveTransactionInvocation(sent, {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    returnValue: "ok",
  } as rpc.Api.GetTransactionResponse);
  assert.equal(outcome.type, "success");
  assert.equal(outcome.hash, "tx-success");
});

await run("returns failed outcome with expected message", async () => {
  const sent: SendTransactionResult = { hash: "tx-failed", status: "PENDING" };
  const outcome = resolveTransactionInvocation(sent, {
    status: rpc.Api.GetTransactionStatus.FAILED,
  } as rpc.Api.GetTransactionResponse);
  assert.equal(outcome.type, "failed");
  assert.equal(outcome.error, "Transaction failed: tx-failed");
});

await run("uses submission error path when send status is ERROR", async () => {
  const sent: SendTransactionResult = { hash: "tx-send-error", status: "ERROR" };
  const outcome = resolveTransactionInvocation(sent, null);
  assert.equal(outcome.type, "submissionError");
  assert.equal(
    outcome.error,
    "Submission status was ERROR and could not be confirmed yet; check explorer for this transaction: tx-send-error"
  );
});

await run("classifies delayed success after transient lookup failures", async () => {
  const calls: (() => Promise<TransactionResult>)[] = [
    async () => {
      throw new Error("temporary network issue");
    },
    async () => {
      throw new Error("temporary node issue");
    },
    async () => ({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: null,
    }) as TransactionResult,
  ];
  let index = 0;
  const getTransaction = async () => calls[index++]();
  const result = await waitForTransactionResult(
    "tx-delayed-success",
    3,
    1,
    getTransaction as unknown as (hash: string) => Promise<rpc.Api.GetTransactionResponse>,
    noSleep
  );
  assert.equal(index, 3);
  assert.equal(result?.status, rpc.Api.GetTransactionStatus.SUCCESS);
});

await run("returns timeout when no final status is observed", async () => {
  const getTransaction = async () => ({ status: "PENDING" }) as TransactionResult;
  const result = await waitForTransactionResult(
    "tx-timeout",
    2,
    1,
    getTransaction as unknown as (hash: string) => Promise<rpc.Api.GetTransactionResponse>,
    noSleep
  );
  assert.equal(result, null);
});

if (process.exitCode) {
  process.exit(1);
}

console.log("Transaction confirmation regression checks completed.");
