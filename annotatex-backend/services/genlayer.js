const { createClient } = require("genlayer-js");
const { testnetBradbury } = require("genlayer-js/chains");
const { abi } = require("genlayer-js");
const { encodeFunctionData, parseEventLogs } = require("viem");
const { ethers } = require("ethers");

// All GenLayer reads use Bradbury. The backend never signs a transaction;
// browser wallets approve the prepared transaction objects below.
const client = createClient({ chain: testnetBradbury });
const contractAddress = process.env.GENLAYER_CONTRACT;

function taskArgs(taskId) {
  return [BigInt(taskId)];
}

async function read(functionName, taskId) {
  return client.readContract({ address: contractAddress, functionName, args: taskArgs(taskId) });
}

async function getTaskCount() {
  return client.readContract({ address: contractAddress, functionName: "get_task_count", args: [] });
}

async function getTask(taskId) { return read("get_task", taskId); }
async function getTaskCreator(taskId) { return read("get_task_creator", taskId); }
async function getBounty(taskId) { return read("get_bounty", taskId); }
async function hasSubmitted(taskId) { return read("has_submitted", taskId); }
async function getVerdict(taskId) { return read("get_verdict", taskId); }
async function getSubmission(taskId) { return read("get_submission", taskId); }
async function getWorker(taskId) { return read("get_worker", taskId); }
async function isClaimed(taskId) { return read("is_claimed", taskId); }
async function isPaid(taskId) { return read("is_paid", taskId); }
async function isRefunded(taskId) { return read("is_refunded", taskId); }
async function getDeadline(taskId) { return read("get_deadline", taskId); }
async function canRecover(taskId) { return read("can_recover", taskId); }
async function getPayoutStatus(taskId) { return read("get_payout_status", taskId); }

function encodeConsensusTransaction(sender, functionName, args, value = 0n) {
  if (!sender || !ethers.isAddress(sender)) throw new Error("A valid wallet address is required for the GenLayer transaction");
  if (!contractAddress) throw new Error("GENLAYER_CONTRACT is not configured");

  const innerCalldata = abi.calldata.encode(abi.calldata.makeCalldataObject(functionName, args));
  const serializedData = abi.transactions.serialize([innerCalldata, false]);
  const data = encodeFunctionData({
    abi: testnetBradbury.consensusMainContract.abi,
    functionName: "addTransaction",
    args: [
      ethers.getAddress(sender),
      ethers.getAddress(contractAddress),
      BigInt(testnetBradbury.defaultNumberOfInitialValidators),
      BigInt(testnetBradbury.defaultConsensusMaxRotations),
      serializedData,
      BigInt(Math.floor(Date.now() / 1000) + 3600),
    ],
  });

  return {
    to: testnetBradbury.consensusMainContract.address,
    data,
    value: `0x${BigInt(value).toString(16)}`,
  };
}

function amountToWei(amount) {
  const [whole, fraction = ""] = String(amount).split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

async function prepareCreateTask(taskText, bounty, sender) {
  return encodeConsensusTransaction(sender, "create_task", [taskText], amountToWei(bounty));
}

async function prepareSubmitAnnotation(taskId, annotation, sender) {
  return encodeConsensusTransaction(sender, "submit_annotation", [BigInt(taskId), annotation]);
}

async function prepareClaimTask(taskId, sender) {
  return encodeConsensusTransaction(sender, "claim_task", [BigInt(taskId)]);
}

async function prepareClaimReward(taskId, sender) {
  return encodeConsensusTransaction(sender, "claim_reward", [BigInt(taskId)]);
}

async function prepareRecoverBounty(taskId, sender) {
  return encodeConsensusTransaction(sender, "recover_bounty", [BigInt(taskId)]);
}

async function getGenLayerTransactionHash(evmTransactionHash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(evmTransactionHash || ""))) return null;
  const receipt = await client.request({ method: "eth_getTransactionReceipt", params: [evmTransactionHash] });
  if (!receipt || receipt.status === "0x0" || !Array.isArray(receipt.logs)) return null;
  for (const eventName of ["NewTransaction", "CreatedTransaction"]) {
    const events = parseEventLogs({ abi: testnetBradbury.consensusMainContract.abi, eventName, logs: receipt.logs });
    if (events[0]?.args?.txId) return events[0].args.txId;
  }
  return null;
}

module.exports = {
  getTaskCount,
  getTask,
  getTaskCreator,
  getBounty,
  hasSubmitted,
  getVerdict,
  getSubmission,
  getWorker,
  isClaimed,
  isPaid,
  isRefunded,
  getDeadline,
  canRecover,
  getPayoutStatus,
  prepareCreateTask,
  prepareSubmitAnnotation,
  prepareClaimTask,
  prepareClaimReward,
  prepareRecoverBounty,
  getGenLayerTransactionHash,
};
