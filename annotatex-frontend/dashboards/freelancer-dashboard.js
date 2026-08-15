(async function () {
const { apiFetch, showMessage, escapeHTML, shortWallet, formatDate, formatAmount, statusLabel, displayStatus, initializeTheme, initializeMobileMenu, requireDashboardRole, connectWallet, sendPreparedTransaction, logout } = window.AnnotateX;

let currentUser;
let connectedWallet = null;
let available = [];
let work = [];
const $ = (selector) => document.querySelector(selector);

function setWallet(wallet) {
  connectedWallet = wallet;
  $("#wallet-address").textContent = wallet || "Not connected";
  $("#wallet-status").textContent = wallet ? `Connected  -  ${shortWallet(wallet)}` : "Wallet not connected";
  $("#connect-wallet").textContent = wallet ? "Wallet connected" : "Connect wallet";
  $("#profile-connect").textContent = wallet ? "Wallet connected" : "Connect wallet";
}

async function connect() {
  try {
    setWallet(await connectWallet(currentUser.wallet));
    showMessage($("#dashboard-message"), "Wallet connected. You can now claim and submit work.", "success");
  } catch (error) { showMessage($("#dashboard-message"), error.message, "error"); }
}

function renderStats() {
  $("#active-count").textContent = work.filter((task) => task.status === "CLAIMED").length;
  $("#review-count").textContent = work.filter((task) => task.status === "UNDER_REVIEW").length;
  $("#completed-count").textContent = work.filter((task) => ["APPROVED", "PAID"].includes(task.status)).length;
  $("#earnings-count").textContent = formatAmount(work.filter((task) => task.status === "PAID").reduce((sum, task) => sum + Number(task.bountyAmount || 0), 0));
}

function taskCard(task, action) {
  return `<article class="available-bounty"><div class="bounty-card-top"><span class="bounty-status status-${statusLabel(task.state || task.status)}">${escapeHTML(displayStatus(task.state || task.status))}</span><span class="bounty-amount">${escapeHTML(formatAmount(task.bountyAmount))}</span></div><h3>${escapeHTML(task.title)}</h3><p>${escapeHTML(task.description)}</p><div class="task-meta"><span>Client ${escapeHTML(shortWallet(task.creatorWallet))}</span><span>Posted ${escapeHTML(formatDate(task.createdAt))}</span></div>${action}</article>`;
}

function renderAvailable() {
  const list = $("#available-list");
  if (!available.length) { list.innerHTML = `<div class="dashboard-empty"><h3>No open bounties right now.</h3><p>New tasks will appear here as clients fund them. Refresh when you are ready.</p></div>`; return; }
  list.innerHTML = available.map((task) => taskCard(task, `<button class="dashboard-button primary claim-button" type="button" data-id="${escapeHTML(task.id)}">Claim bounty</button>`)).join("");
  list.querySelectorAll(".claim-button").forEach((button) => button.addEventListener("click", () => claimTask(button.dataset.id, button)));
}

function workAction(task) {
  if (!task.chain?.linked) return `<div class="work-result">Local record - no Bradbury state</div>`;
  if (task.status === "CLAIMED") return `<button class="dashboard-button primary submit-button" type="button" data-id="${escapeHTML(task.id)}">Submit work</button>`;
  if (task.status === "UNDER_REVIEW") {
    const explorerLink = task.chain.submissionTransactionUrl
      ? `<a class="explorer-link" href="${escapeHTML(task.chain.submissionTransactionUrl)}" target="_blank" rel="noopener noreferrer">Track consensus in Bradbury Explorer -&gt;</a>`
      : "";
    return `<div class="work-result">Submitted / pending validation with GenLayer...${explorerLink}</div>`;
  }
  if (task.status === "APPROVED") return `<button class="dashboard-button primary reward-button" type="button" data-id="${escapeHTML(task.id)}">Claim reward</button>`;
  if (task.status === "REJECTED") return `<div class="work-result">Rejected by GenLayer - no reward. The client can recover the escrow.</div>`;
  if (task.status === "REFUNDED") return `<div class="work-result">Bounty refunded to the client</div>`;
  if (task.status === "PAID") return `<div class="work-result">Reward paid</div>`;
  return `<div class="work-result">Awaiting on-chain state</div>`;
}

function renderWork() {
  const list = $("#work-list");
  if (!work.length) { list.innerHTML = `<div class="dashboard-empty"><h3>Your work queue is empty.</h3><p>Claim an available bounty and it will show up here with a private submission form.</p></div>`; return; }
  list.innerHTML = work.map((task) => `<article class="work-item"><div><span class="bounty-status status-${statusLabel(task.state || task.status)}">${escapeHTML(displayStatus(task.state || task.status))}</span><h3>${escapeHTML(task.title)}</h3><p>${escapeHTML(formatAmount(task.bountyAmount))}  -  Claimed ${escapeHTML(formatDate(task.claimedAt))}</p><small>${task.chain?.linked ? `Bradbury task #${escapeHTML(String(task.chain.taskId))}` : "Local record  -  not on-chain"}</small>${task.verification?.verdict && task.chain?.linked ? `<small>GenLayer verdict: ${escapeHTML(displayStatus(task.verification.verdict))}</small>` : ""}${task.payout?.status === "claimable" ? "<small>Payout: CLAIMABLE</small>" : ""}</div>${workAction(task)}</article>`).join("");
  list.querySelectorAll(".submit-button").forEach((button) => button.addEventListener("click", () => openSubmitForm(button.dataset.id)));
  list.querySelectorAll(".reward-button").forEach((button) => button.addEventListener("click", () => claimReward(button.dataset.id, button)));
}

function renderSubmitForm(task) {
  const existing = $("#submission-panel");
  if (existing) existing.remove();
  const panel = document.createElement("section");
  panel.id = "submission-panel";
  panel.className = "create-bounty-card submission-panel";
  panel.innerHTML = `<div class="create-bounty-header"><p class="eyebrow">SUBMIT WORK</p><h2>${escapeHTML(task.title)}</h2><p class="create-bounty-intro">Your submission is sent to the GenLayer Intelligent Contract, which evaluates it against the original client instructions. You cannot edit it after submission.</p></div><form class="bounty-form" id="submission-form"><div class="form-group"><label for="submission-content">Completed work</label><textarea id="submission-content" name="annotation" minlength="5" maxlength="10000" placeholder="Add the labels, evaluation or annotated result here." required></textarea></div><button class="dashboard-button primary" type="submit">Submit for GenLayer review</button><button class="dashboard-button" id="cancel-submission" type="button">Cancel</button><p class="form-message" id="submission-message"></p></form>`;
  $("#my-work").prepend(panel);
  $("#cancel-submission").addEventListener("click", () => panel.remove());
  $("#submission-form").addEventListener("submit", (event) => submitWork(event, task));
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openSubmitForm(id) {
  const task = work.find((item) => item.id === id);
  if (task) renderSubmitForm(task);
}

async function claimTask(id, button) {
  button.disabled = true; button.textContent = "Preparing...";
  try {
    if (!connectedWallet) await connect();
    if (!connectedWallet) throw new Error("Connect the wallet linked to this profile before claiming work.");
    const prepared = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/claim/prepare`, { method: "POST", body: "{}" });
    const transactionHash = prepared.transaction ? await sendPreparedTransaction(prepared.transaction, connectedWallet) : null;
    await apiFetch(`/api/tasks/${encodeURIComponent(id)}/claim`, { method: "POST", body: JSON.stringify({ transactionHash }) });
    showMessage($("#dashboard-message"), "Bounty claimed. Complete the work and submit it when ready.", "success");
    await loadData();
  } catch (error) { button.disabled = false; button.textContent = "Claim bounty"; showMessage($("#dashboard-message"), error.message, "error"); }
}

async function submitWork(event, task) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = $("#submission-message");
  const annotation = form.annotation.value.trim();
  button.disabled = true; button.textContent = "Preparing...";
  try {
    const prepared = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/submit/prepare`, { method: "POST", body: JSON.stringify({ annotation }) });
    const transactionHash = prepared.transaction ? await sendPreparedTransaction(prepared.transaction, connectedWallet) : null;
    message.textContent = "Submission transaction approved. Waiting for GenLayer consensus...";
    await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/submit`, { method: "POST", body: JSON.stringify({ annotation, transactionHash }) });
    $("#submission-panel").remove();
    showMessage($("#dashboard-message"), "Submission recorded. Verifying with GenLayer...", "success");
    await loadData();
  } catch (error) { button.disabled = false; button.textContent = "Submit for GenLayer review"; message.textContent = error.message; message.className = "form-message form-error"; }
}

async function claimReward(id, button) {
  button.disabled = true; button.textContent = "Preparing payout...";
  try {
    if (!connectedWallet) await connect();
    if (!connectedWallet) throw new Error("Connect the wallet linked to this profile before claiming a reward.");
    const prepared = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/reward/prepare`, { method: "POST", body: "{}" });
    const transactionHash = await sendPreparedTransaction(prepared.transaction, connectedWallet);
    await apiFetch(`/api/tasks/${encodeURIComponent(id)}/reward/confirm`, { method: "POST", body: JSON.stringify({ transactionHash }) });
    showMessage($("#dashboard-message"), "Reward transaction submitted. Waiting for the on-chain payout to finalize...", "success");
    await loadData();
  } catch (error) { button.disabled = false; button.textContent = "Claim reward"; showMessage($("#dashboard-message"), error.message, "error"); }
}

async function loadData() {
  try {
    const [availableData, workData] = await Promise.all([apiFetch("/api/tasks/available"), apiFetch("/api/tasks/work")]);
    available = availableData.tasks || [];
    work = workData.tasks || [];
    renderStats(); renderAvailable(); renderWork();
  } catch (error) { showMessage($("#dashboard-message"), error.message, "error"); }
}

async function initialize() {
  initializeTheme(); initializeMobileMenu();
  currentUser = await requireDashboardRole("freelancer");
  if (!currentUser) return;
  $("#username").textContent = currentUser.username; $("#profile-name").textContent = currentUser.username; $("#profile-card-name").textContent = currentUser.username; $("#profile-avatar").textContent = currentUser.username.charAt(0).toUpperCase();
  $("#connect-wallet").addEventListener("click", connect); $("#profile-connect").addEventListener("click", connect); $("#logout-button").addEventListener("click", logout); $("#refresh-button").addEventListener("click", loadData); setWallet(null);
  if (window.ethereum) { const accounts = await window.ethereum.request({ method: "eth_accounts" }).catch(() => []); if (accounts[0]?.toLowerCase() === currentUser.wallet.toLowerCase()) setWallet(accounts[0]); window.ethereum.on?.("accountsChanged", (next) => setWallet(next[0]?.toLowerCase() === currentUser.wallet.toLowerCase() ? next[0] : null)); }
  await loadData();
  window.setInterval(loadData, 10000);
}

initialize();
})();
