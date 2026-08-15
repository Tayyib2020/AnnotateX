(async function () {
const { apiFetch, showMessage, escapeHTML, shortWallet, formatDate, formatAmount, statusLabel, displayStatus, initializeTheme, initializeMobileMenu, requireDashboardRole, connectWallet, sendPreparedTransaction, logout } = window.AnnotateX;

let currentUser;
let connectedWallet = null;
let tasks = [];
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
    showMessage($("#dashboard-message"), "Wallet connected. You are ready to prepare transactions.", "success");
  } catch (error) { showMessage($("#dashboard-message"), error.message, "error"); }
}

function renderStats() {
  $("#active-count").textContent = tasks.filter((task) => ["OPEN", "CLAIMED"].includes(task.status)).length;
  $("#review-count").textContent = tasks.filter((task) => task.status === "UNDER_REVIEW").length;
  $("#completed-count").textContent = tasks.filter((task) => ["APPROVED", "PAID"].includes(task.status)).length;
  $("#committed-amount").textContent = formatAmount(tasks.reduce((sum, task) => sum + Number(task.bountyAmount || 0), 0));
}

function renderTasks() {
  const list = $("#bounty-list");
  if (!tasks.length) {
    list.innerHTML = `<div class="dashboard-empty"><h3>Your pipeline is clear.</h3><p>Create a bounty and it will appear here with its funding, claim and verification state.</p><a class="dashboard-button primary" href="#create">Create your first bounty</a></div>`;
    return;
  }
  list.innerHTML = tasks.map((task) => {
    const fundingLink = task.chain?.fundingTransactionUrl
      ? `<a class="explorer-link" href="${escapeHTML(task.chain.fundingTransactionUrl)}" target="_blank" rel="noopener noreferrer">Track funding in Bradbury Explorer -&gt;</a>`
      : "";
    const payoutLink = task.chain?.payoutTransactionUrl
      ? `<a class="explorer-link" href="${escapeHTML(task.chain.payoutTransactionUrl)}" target="_blank" rel="noopener noreferrer">Track payout in Bradbury Explorer -&gt;</a>`
      : "";
    const recoveryLink = task.chain?.recoveryTransactionUrl
      ? `<a class="explorer-link" href="${escapeHTML(task.chain.recoveryTransactionUrl)}" target="_blank" rel="noopener noreferrer">Track refund in Bradbury Explorer -&gt;</a>`
      : "";
    const recoveryAction = task.recovery?.eligible && !task.recovery?.pending && !["paid", "refunded"].includes(task.payout?.status)
      ? `<button class="dashboard-button recovery-button" type="button" data-id="${escapeHTML(task.id)}">Recover escrow</button>`
      : task.recovery?.pending ? `<div class="work-result">Refund transaction pending finalization</div>` : "";
    const payoutState = task.payout?.status === "claimable" ? "CLAIMABLE" : task.payout?.status === "paid" ? "PAID" : task.payout?.status === "refunded" ? "REFUNDED" : "";
    return `<article class="dashboard-bounty"><div class="bounty-card-top"><span class="bounty-status status-${statusLabel(task.state || task.status)}">${escapeHTML(displayStatus(task.state || task.status))}</span><span class="bounty-amount">${escapeHTML(formatAmount(task.bountyAmount))}</span></div><h3>${escapeHTML(task.title)}</h3><p>${escapeHTML(task.description)}</p><div class="task-meta"><span>Created ${escapeHTML(formatDate(task.createdAt))}</span><span>${task.claimedBy ? `Claimed by ${escapeHTML(shortWallet(task.claimedBy))}` : "Open to the marketplace"}</span></div><div class="task-meta"><span>${task.chain?.linked ? `Bradbury task #${escapeHTML(String(task.chain.taskId))}` : "Local record  -  not on-chain"}</span>${payoutState ? `<span>Payout: ${escapeHTML(payoutState)}</span>` : ""}</div>${fundingLink || payoutLink || recoveryLink ? `<div class="task-meta">${fundingLink}${payoutLink}${recoveryLink}</div>` : ""}${task.verification && task.chain?.linked ? `<div class="verification-note"><strong>GenLayer: ${escapeHTML(displayStatus(task.verification.verdict || "UNDER_REVIEW"))}</strong><span>${task.status === "UNDER_REVIEW" ? "Validators are evaluating the submission against your original instructions." : "Consensus verdict recorded on-chain."}</span></div>` : ""}${recoveryAction ? `<div class="task-actions">${recoveryAction}</div>` : ""}</article>`;
  }).join("");
  list.querySelectorAll(".recovery-button").forEach((button) => button.addEventListener("click", () => recoverBounty(button.dataset.id, button)));
}

async function loadTasks() {
  try {
    const data = await apiFetch("/api/tasks/mine");
    tasks = data.tasks || [];
    renderStats();
    renderTasks();
  } catch (error) { showMessage($("#dashboard-message"), error.message, "error"); }
}

async function recoverBounty(id, button) {
  button.disabled = true;
  button.textContent = "Preparing refund...";
  try {
    if (!connectedWallet) await connect();
    if (!connectedWallet) throw new Error("Connect the wallet linked to this client profile before recovering funds.");
    const prepared = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/recovery/prepare`, { method: "POST", body: "{}" });
    const transactionHash = await sendPreparedTransaction(prepared.transaction, connectedWallet);
    await apiFetch(`/api/tasks/${encodeURIComponent(id)}/recovery/confirm`, { method: "POST", body: JSON.stringify({ transactionHash }) });
    showMessage($("#dashboard-message"), "Recovery transaction submitted. Waiting for the Bradbury refund to finalize...", "success");
    await loadTasks();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Recover escrow";
    showMessage($("#dashboard-message"), error.message, "error");
  }
}

async function createBounty(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#create-bounty-button");
  const message = $("#bounty-form-message");
  const description = form.description.value.trim();
  const amount = form.amount.value.trim();
  const title = form.title.value.trim();
  button.disabled = true;
  button.textContent = "Preparing transaction...";
  message.textContent = "";
  try {
    const prepared = await apiFetch("/api/tasks/prepare", { method: "POST", body: JSON.stringify({ description, amount }) });
    let transactionHash = null;
    if (prepared.transaction) {
      if (!connectedWallet) await connect();
      if (!connectedWallet) throw new Error("Connect the account that owns this client profile before funding the bounty.");
      message.textContent = "Approve the funding transaction in your wallet...";
      transactionHash = await sendPreparedTransaction(prepared.transaction, connectedWallet);
      message.textContent = "Transaction approved. Indexing the bounty...";
    } else {
      message.textContent = "Blockchain contract is not configured; saving an unfunded local bounty for development only.";
    }
    await apiFetch("/api/tasks/confirm", { method: "POST", body: JSON.stringify({ title, description, amount, transactionHash, chainTaskId: prepared.chainTaskId }) });
    form.reset();
    message.textContent = transactionHash ? "Bounty funded and added to your pipeline." : "Bounty added in local development mode.";
    message.className = "form-message form-success";
    await loadTasks();
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message form-error";
  } finally { button.disabled = false; button.textContent = "Prepare bounty"; }
}

async function initialize() {
  initializeTheme();
  initializeMobileMenu();
  currentUser = await requireDashboardRole("client");
  if (!currentUser) return;
  $("#username").textContent = currentUser.username;
  $("#profile-name").textContent = currentUser.username;
  $("#profile-card-name").textContent = currentUser.username;
  $("#profile-avatar").textContent = currentUser.username.charAt(0).toUpperCase();
  $("#create-bounty-form").addEventListener("submit", createBounty);
  $("#connect-wallet").addEventListener("click", connect);
  $("#profile-connect").addEventListener("click", connect);
  $("#logout-button").addEventListener("click", logout);
  $("#refresh-button").addEventListener("click", loadTasks);
  setWallet(null);
  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: "eth_accounts" }).catch(() => []);
    if (accounts[0]?.toLowerCase() === currentUser.wallet.toLowerCase()) setWallet(accounts[0]);
    window.ethereum.on?.("accountsChanged", (next) => setWallet(next[0]?.toLowerCase() === currentUser.wallet.toLowerCase() ? next[0] : null));
  }
  await loadTasks();
  window.setInterval(loadTasks, 10000);
}

initialize();
})();
