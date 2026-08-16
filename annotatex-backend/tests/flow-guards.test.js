const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const persistence = fs.readFileSync(path.join(__dirname, "..", "persistence.js"), "utf8");
const clientDashboard = fs.readFileSync(path.join(__dirname, "..", "..", "annotatex-frontend", "dashboards", "client-dashboard.js"), "utf8");
const contract = fs.readFileSync(path.join(__dirname, "..", "..", "annotatex-contract", "AnnotateXBounty.py"), "utf8");

test("a non-empty submission cannot be approved or paid by Express", () => {
  assert.doesNotMatch(server, /provider:\s*["']genlayer-adapter["']/);
  assert.match(server, /task\.status = "UNDER_REVIEW"/);
  assert.match(server, /Verification is performed by the GenLayer Intelligent Contract/);
  assert.match(server, /taskStatus\(task\) !== "APPROVED"/);
});

test("the contract separates evaluation from payout", () => {
  const submitStart = contract.indexOf("def submit_annotation");
  const rewardStart = contract.indexOf("def claim_reward");
  assert.ok(submitStart >= 0 && rewardStart > submitStart);
  const submissionSection = contract.slice(submitStart, rewardStart);
  assert.match(submissionSection, /run_nondet_unsafe/);
  assert.match(submissionSection, /def validator_accepts/);
  assert.match(submissionSection, /leader_data\.get\("verdict"\)/);
  assert.match(submissionSection, /task\.verdict = verdict/);
  assert.doesNotMatch(submissionSection, /emit_transfer/);
  assert.match(contract.slice(rewardStart), /task\.verdict != "APPROVED"/);
  assert.match(contract.slice(rewardStart), /task\.paid/);
  assert.match(contract, /def recover_bounty/);
  assert.match(contract, /Only the task creator can recover the bounty/);
  assert.match(contract, /task\.verdict == "REJECTED" or self\._now\(\) > task\.deadline/);
  assert.match(contract, /task\.refunded/);
});

test("read paths persist finalized GenLayer state", () => {
  assert.match(server, /async function syncTasksFromGenLayer\(tasks, marketplace = null\)/);
  assert.match(server, /if \(marketplace\) await saveMarketplace\(marketplace\);/);
  assert.match(server, /app\.get\("\/api\/tasks\/work"[\s\S]*?syncTasksFromGenLayer\(marketplace\.tasks[\s\S]*?marketplace\s*\)/);
  assert.match(server, /app\.get\("\/api\/tasks\/:id"[\s\S]*?await syncTaskFromGenLayer\(task\);\s+await saveMarketplace\(marketplace\);/);
});

test("production uses durable PostgreSQL state and sessions", () => {
  assert.match(server, /DATABASE_URL must be set to the production PostgreSQL database/);
  assert.match(server, /tableName: "annotatex_sessions"/);
  assert.match(server, /await persistence\.init\(\)/);
  assert.match(persistence, /CREATE TABLE IF NOT EXISTS annotatex_state/);
  assert.match(persistence, /ON CONFLICT \(state_key\) DO UPDATE/);
});

test("submission preparation reads and saves the same marketplace", () => {
  assert.doesNotMatch(server, /findTask\(readMarketplace\(\), req\.params\.id\)/);
  assert.match(server, /const marketplace = await readMarketplace\(\);\s+const task = findTask\(marketplace, req\.params\.id\);/);
});

test("the client dashboard exposes real funding and payout Explorer links", () => {
  assert.match(clientDashboard, /task\.chain\?\.fundingTransactionUrl/);
  assert.match(clientDashboard, /task\.chain\?\.payoutTransactionUrl/);
  assert.match(clientDashboard, /Track funding in Bradbury Explorer/);
  assert.match(clientDashboard, /Track payout in Bradbury Explorer/);
  assert.match(clientDashboard, /recoveryTransactionUrl/);
  assert.match(clientDashboard, /recovery\/prepare/);
  assert.match(clientDashboard, /REFUND TRANSACTION PENDING/);
  assert.match(clientDashboard, /available for recovery/);
  assert.match(clientDashboard, /has been returned on-chain/);
  assert.match(clientDashboard, /Recover \$\{escapeHTML\(bountyAmount\)\}/);
});

test("on-chain sync uses the contract bounty amount and recovery state", () => {
  assert.match(server, /getBounty\(task\.chainTaskId\)/);
  assert.match(server, /task\.bountyAmount = formatGenAmount\(rawBounty\)/);
  assert.match(server, /status: task\.payout\?\.status === "refunded"/);
  assert.match(server, /task\.recoveryEligible === true/);
});
