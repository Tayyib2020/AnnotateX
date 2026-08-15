const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
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
  assert.match(submissionSection, /prompt_non_comparative/);
  assert.match(submissionSection, /task\.verdict = verdict/);
  assert.doesNotMatch(submissionSection, /emit_transfer/);
  assert.match(contract.slice(rewardStart), /task\.verdict != "APPROVED"/);
  assert.match(contract.slice(rewardStart), /task\.paid/);
});

test("read paths persist finalized GenLayer state", () => {
  assert.match(server, /async function syncTasksFromGenLayer\(tasks, marketplace = null\)/);
  assert.match(server, /if \(marketplace\) saveMarketplace\(marketplace\);/);
  assert.match(server, /app\.get\("\/api\/tasks\/work"[\s\S]*?syncTasksFromGenLayer\(marketplace\.tasks[\s\S]*?marketplace\s*\)/);
  assert.match(server, /app\.get\("\/api\/tasks\/:id"[\s\S]*?await syncTaskFromGenLayer\(task\);\s+saveMarketplace\(marketplace\);/);
});
