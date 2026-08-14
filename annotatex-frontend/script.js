const API_URL = "";
const html = document.documentElement;

function applyTheme(theme) {
  html.dataset.theme = theme === "dark" ? "dark" : "light";
  localStorage.setItem("annotatex-theme", html.dataset.theme);
  document.querySelectorAll(".theme-toggle").forEach((button) => button.setAttribute("aria-label", html.dataset.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"));
}

function initializeTheme() {
  const saved = localStorage.getItem("annotatex-theme");
  applyTheme(saved || "light");
  document.querySelectorAll(".theme-toggle").forEach((button) => button.addEventListener("click", () => applyTheme(html.dataset.theme === "dark" ? "light" : "dark")));
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

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function wallet() {
  if (!window.ethereum) throw new Error("No compatible wallet detected. Install MetaMask or another EVM wallet.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No wallet account was returned.");
  return accounts[0];
}

async function authenticate(mode, form) {
  const connected = await wallet();
  const nonce = await api("/api/auth/nonce", { method: "POST", body: JSON.stringify({ wallet: connected }) });
  let signature;
  try {
    signature = await window.ethereum.request({ method: "personal_sign", params: [nonce.message, connected] });
  } catch {
    throw new Error("Wallet signature was rejected. AnnotateX uses a message signature and never asks for transaction keys.");
  }
  if (mode === "login") return api("/api/auth/login", { method: "POST", body: JSON.stringify({ wallet: connected, signature }) });
  return api("/api/auth/signup", { method: "POST", body: JSON.stringify({ wallet: connected, signature, username: form.username.value.trim(), role: form.role.value }) });
}

function createAuthModal() {
  if (document.querySelector("#auth-modal")) return;
  const modal = document.createElement("div");
  modal.id = "auth-modal";
  modal.innerHTML = `<div class="auth-backdrop"></div><div class="auth-modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button type="button" class="auth-close" aria-label="Close">×</button><p class="eyebrow">ANNOTATEX IDENTITY</p><h2 id="auth-title">Create your account</h2><p id="auth-description">Connect your wallet, choose a role and sign a one-time message.</p><form id="auth-form"><div class="auth-role-group"><label class="auth-role active"><input type="radio" name="role" value="client" checked><strong>Client</strong><span>Post and fund bounties</span></label><label class="auth-role"><input type="radio" name="role" value="freelancer"><strong>Freelancer</strong><span>Complete and earn</span></label></div><label class="auth-field" id="auth-username-field"><span>Username</span><input id="auth-username" name="username" type="text" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" placeholder="e.g. data_sage" autocomplete="off"></label><button type="submit" id="auth-submit" class="auth-submit">Connect & sign up</button></form><p id="auth-message" class="auth-message" role="status"></p></div>`;
  document.body.appendChild(modal);
  const close = () => modal.classList.remove("open");
  modal.querySelector(".auth-close").addEventListener("click", close);
  modal.querySelector(".auth-backdrop").addEventListener("click", close);
  modal.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const message = modal.querySelector("#auth-message");
    button.disabled = true;
    button.textContent = "Waiting for wallet...";
    message.textContent = "";
    try {
      const data = await authenticate(modal.dataset.mode, form);
      window.location.href = data.user.role === "client" ? "dashboards/client-dashboard.html" : "dashboards/freelancer-dashboard.html";
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
      button.textContent = modal.dataset.mode === "login" ? "Connect & log in" : "Connect & sign up";
    }
  });
}

function openAuth(mode) {
  createAuthModal();
  const modal = document.querySelector("#auth-modal");
  modal.dataset.mode = mode;
  const signup = mode === "signup";
  modal.querySelector("#auth-title").textContent = signup ? "Create your account" : "Welcome back";
  modal.querySelector("#auth-description").textContent = signup ? "Connect your wallet, choose a role and sign a one-time message." : "Connect your registered wallet and sign a one-time message to continue.";
  modal.querySelector("#auth-username-field").hidden = !signup;
  modal.querySelector(".auth-role-group").hidden = !signup;
  modal.querySelector("#auth-username").required = signup;
  modal.querySelector("#auth-submit").textContent = signup ? "Connect & sign up" : "Connect & log in";
  modal.querySelector("#auth-message").textContent = "";
  modal.classList.add("open");
  modal.querySelector(signup ? "#auth-username" : "#auth-submit").focus();
}

initializeTheme();
initializeMobileMenu();
document.querySelectorAll(".signup-button, .js-signup").forEach((button) => button.addEventListener("click", () => openAuth("signup")));
document.querySelectorAll(".nav-login, .js-login, .bounty-action").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); openAuth("login"); }));
