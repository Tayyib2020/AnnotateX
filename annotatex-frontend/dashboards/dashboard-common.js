const API_URL = "";

const BRADBURY = {
  chainId: "0x107d",
  chainName: "GenLayer Bradbury Testnet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://rpc-bradbury.genlayer.com"],
  blockExplorerUrls: ["https://explorer-bradbury.genlayer.com/"],
};

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showMessage(element, message, type = "info") {
  if (!element) return;
  element.hidden = !message;
  element.textContent = message || "";
  element.className = `dashboard-message ${type}`;
}

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function shortWallet(wallet) {
  if (!wallet) return "Not connected";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatAmount(amount) {
  const number = Number(amount || 0);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 6 })} GEN`;
}

function statusLabel(status) {
  return String(status || "OPEN").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function displayStatus(status) {
  return String(status || "OPEN").replaceAll("_", " ");
}

function shouldShowRecoveryAction(task) {
  const state = String(task?.state || task?.status || "").toUpperCase();
  const payoutStatus = String(task?.payout?.status || "").toLowerCase();
  return task?.recovery?.eligible === true
    && task?.recovery?.pending !== true
    && !["APPROVED", "PAID", "REFUNDED"].includes(state)
    && !["paid", "refunded"].includes(payoutStatus);
}

// Keep dashboard text ASCII-safe so wallet labels and loading states do not
// become mojibake when the static files are served with a different encoding.
function shortWallet(wallet) {
  if (!wallet) return "Not connected";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  localStorage.setItem("annotatex-theme", theme === "dark" ? "dark" : "light");
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  });
}

function initializeTheme() {
  const saved = localStorage.getItem("annotatex-theme");
  const preferred = saved || "light";
  applyTheme(preferred);
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    button.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  });
}

function initializeMobileMenu() {
  const toggle = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");
  if (!toggle || !links) return;
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("mobile-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => links.classList.remove("mobile-open")));
}

async function getCurrentUser() {
  try {
    const data = await apiFetch("/api/auth/me");
    return data.user || null;
  } catch {
    return null;
  }
}

async function requireDashboardRole(role) {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "../index.html?auth=required";
    return null;
  }
  if (user.role !== role) {
    window.location.href = user.role === "client" ? "client-dashboard.html" : "freelancer-dashboard.html";
    return null;
  }
  return user;
}

async function connectWallet(expectedWallet = null) {
  if (!window.ethereum) throw new Error("No compatible wallet detected. Install MetaMask or another EVM wallet.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No wallet account was returned.");
  const wallet = accounts[0];
  if (expectedWallet && wallet.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error("The connected wallet does not match your AnnotateX account.");
  }
  return wallet;
}

async function switchToBradbury() {
  if (!window.ethereum) throw new Error("No compatible wallet detected.");
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BRADBURY.chainId }] });
  } catch (error) {
    if (error.code !== 4902) throw new Error("Please switch your wallet to GenLayer Bradbury Testnet to continue.");
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [BRADBURY] });
  }
}

async function sendPreparedTransaction(transaction, wallet) {
  if (!transaction) return null;
  await switchToBradbury();
  const hash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: wallet, to: transaction.to, data: transaction.data, value: transaction.value || "0x0" }],
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The Bradbury transaction reverted. No GenLayer consensus transaction was created.");
      return hash;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("The wallet transaction was submitted but is still pending. Wait for it to confirm before retrying.");
}

async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
  window.location.href = "../index.html";
}

window.AnnotateX = {
  API_URL, BRADBURY, apiFetch, showMessage, escapeHTML, shortWallet, formatDate, formatAmount,
  statusLabel, displayStatus, shouldShowRecoveryAction, initializeTheme, initializeMobileMenu, getCurrentUser, requireDashboardRole,
  connectWallet, switchToBradbury, sendPreparedTransaction, logout,
};
