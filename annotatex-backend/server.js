const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const { ethers } = require("ethers");
require("dotenv").config();

const { createPersistence } = require("./persistence");

const {
  prepareCreateTask,
  prepareClaimTask,
  prepareSubmitAnnotation,
  prepareClaimReward,
  prepareRecoverBounty,
  getTaskCount,
  getBounty,
  getVerdict,
  getPayoutStatus,
  isPaid,
  isRefunded,
  getDeadline,
  canRecover,
  isClaimed,
  getWorker,
  getGenLayerTransactionHash,
} = require("./services/genlayer");

const app = express();
const PORT = Number(process.env.PORT || 4000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const FRONTEND_DIRECTORY = path.join(__dirname, "..", "annotatex-frontend");
const configuredSessionSecret = process.env.SESSION_SECRET;
if (IS_PRODUCTION && (!configuredSessionSecret || configuredSessionSecret.length < 32)) {
  throw new Error("SESSION_SECRET must be set to a long random value in production");
}
const SESSION_SECRET = configuredSessionSecret || crypto.randomBytes(48).toString("hex");
const CONTRACT_CONFIGURED = Boolean(process.env.GENLAYER_CONTRACT && ethers.isAddress(process.env.GENLAYER_CONTRACT));
const LEGACY_CONTRACT_ADDRESS = "0x63E06B5a9200d737ED6148607110B64356220015".toLowerCase();
if (IS_PRODUCTION && !CONTRACT_CONFIGURED) {
  throw new Error("GENLAYER_CONTRACT must be set to the deployed Bradbury AnnotateX contract in production");
}
const persistence = createPersistence({
  dataDirectory: process.env.ANNOTATEX_DATA_DIR || __dirname,
  importLocalData: process.env.DATABASE_IMPORT_LOCAL_DATA === "true",
});
if (IS_PRODUCTION && !persistence.usesDatabase) {
  throw new Error("DATABASE_URL must be set to the production PostgreSQL database");
}
const pendingBountyPreparations = new Map();

const configuredOrigins = String(process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (IS_PRODUCTION && configuredOrigins.length === 0) {
  throw new Error("FRONTEND_ORIGINS must include the deployed frontend origin in production");
}
const allowedOrigins = new Set(
  configuredOrigins.length > 0 ? configuredOrigins : [`http://localhost:${PORT}`]
);

app.disable("x-powered-by");
if (IS_PRODUCTION) app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by AnnotateX CORS policy"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(
  session({
    name: "annotatex.sid",
    ...(persistence.pool
      ? { store: new (connectPgSimple(session))({ pool: persistence.pool, tableName: "annotatex_sessions", createTableIfMissing: true }) }
      : {}),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(express.static(FRONTEND_DIRECTORY));

function readUsers() {
  return persistence.getUsers();
}

function saveUsers(users) {
  return persistence.saveUsers(users);
}

function readMarketplace() {
  return persistence.getMarketplace();
}

function saveMarketplace(marketplace) {
  return persistence.saveMarketplace(marketplace);
}

function normalizeWallet(wallet) {
  return String(wallet || "").toLowerCase();
}

function publicUser(user) {
  return { id: user.id, username: user.username, wallet: user.wallet, role: user.role };
}

function sessionUser(user) {
  return publicUser(user);
}

function errorResponse(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function requireAuth(req, res, next) {
  if (!req.session.user) return errorResponse(res, 401, "Authentication required");
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return errorResponse(res, 401, "Authentication required");
    if (req.session.user.role !== role) return errorResponse(res, 403, `Only ${role}s can perform this action`);
    return next();
  };
}

function validateUsername(username) {
  const clean = String(username || "").trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(clean)) {
    throw new Error("Username must be 3-20 characters and contain only letters, numbers or underscores");
  }
  return clean;
}

function validateRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (!["client", "freelancer"].includes(normalized)) throw new Error("Invalid account role");
  return normalized;
}

function validateWallet(wallet) {
  if (!wallet || !ethers.isAddress(wallet)) throw new Error("Invalid wallet address");
  return normalizeWallet(wallet);
}

function validateTaskInput(description, amount) {
  const cleanDescription = String(description || "").trim();
  if (cleanDescription.length < 20 || cleanDescription.length > 5000) {
    throw new Error("Task instructions must be between 20 and 5,000 characters");
  }
  const cleanAmount = String(amount ?? "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(cleanAmount) || Number(cleanAmount) <= 0 || Number(cleanAmount) > 1000000) {
    throw new Error("Bounty amount must be a positive GEN value with up to 18 decimals");
  }
  return { description: cleanDescription, amount: cleanAmount };
}

function explorerTransactionUrl(hash) {
  const value = String(hash || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return null;
  const base = process.env.GENLAYER_EXPLORER_URL || "https://explorer-bradbury.genlayer.com/";
  return `${base.replace(/\/+$/, "")}/tx/${value}`;
}

function isOnChainTask(task) {
  const taskContractAddress = task.contractAddress || LEGACY_CONTRACT_ADDRESS;
  return Boolean(
    CONTRACT_CONFIGURED
    && normalizeWallet(taskContractAddress) === normalizeWallet(process.env.GENLAYER_CONTRACT)
    && /^\d+$/.test(String(task.chainTaskId ?? ""))
    && task.genlayerTransactionHash
  );
}

function taskStatus(task) {
  if (!isOnChainTask(task)) return "LOCAL";
  const verdict = String(task.verification?.verdict || task.verdict || "").toUpperCase();
  const onChainVerification = task.verification?.provider === "genlayer-bradbury";
  const onChainPaid = task.payout?.onChain === true && task.payout?.status === "paid";
  const onChainRefunded = task.payout?.onChain === true && task.payout?.status === "refunded";
  if (onChainRefunded) return "REFUNDED";
  if (onChainPaid) return "PAID";
  if (onChainVerification && verdict === "APPROVED") return "APPROVED";
  if (onChainVerification && verdict === "REJECTED") return "REJECTED";
  if (task.submission || task.status === "SUBMITTED" || task.status === "UNDER_REVIEW") return "UNDER_REVIEW";
  if (task.claimedBy || task.status === "CLAIMED") return "CLAIMED";
  return "OPEN";
}

function formatGenAmount(wei) {
  const value = BigInt(wei);
  const unit = 10n ** 18n;
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function reconcileFinalizedRecovery(task, refunded) {
  if (!refunded) return;
  task.recovery = {
    ...(task.recovery || {}),
    status: "refunded",
  };
}

function taskState(task) {
  if (!isOnChainTask(task)) return "LOCAL";
  const status = taskStatus(task);
  if (status === "PAID") return "PAID";
  if (status === "REFUNDED") return "REFUNDED";
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "UNDER_REVIEW") return "SUBMITTED/PENDING VALIDATION";
  return "ACTIVE";
}

function taskForViewer(task, viewer) {
  const isOwner = viewer && normalizeWallet(viewer.wallet) === task.creatorWallet;
  const isWorker = viewer && normalizeWallet(viewer.wallet) === task.claimedBy;
  const chainLinked = isOnChainTask(task);
  const trustedVerification = chainLinked && task.verification?.provider === "genlayer-bradbury"
    ? task.verification
    : chainLinked && task.submission
      ? { status: "pending", provider: "genlayer-bradbury", verdict: "UNDER_REVIEW", checkedAt: null }
      : null;
  const trustedPayout = task.payout?.onChain === true
    ? task.payout
    : { status: task.payout?.status === "pending" ? "pending" : "escrowed", transactionHash: task.payout?.status === "pending" ? task.payout.transactionHash : null, paidAt: null, onChain: false };
  const safe = {
    id: task.id,
    chainTaskId: task.chainTaskId,
    title: task.title,
    description: task.description,
    creatorWallet: task.creatorWallet,
    bountyAmount: task.bountyAmount,
    asset: task.asset,
    status: taskStatus(task),
    state: taskState(task),
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt,
    submittedAt: task.submittedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
      transactionHash: task.transactionHash,
      chain: {
      linked: chainLinked,
      taskId: chainLinked ? task.chainTaskId : null,
      contractAddress: CONTRACT_CONFIGURED ? process.env.GENLAYER_CONTRACT : null,
      network: CONTRACT_CONFIGURED ? "GenLayer Bradbury Testnet" : null,
      explorerUrl: CONTRACT_CONFIGURED ? process.env.GENLAYER_EXPLORER_URL || "https://explorer-bradbury.genlayer.com/" : null,
        fundingTransactionUrl: (isOwner || isWorker) ? explorerTransactionUrl(task.genlayerTransactionHash) : null,
        claimTransactionUrl: (isOwner || isWorker) ? explorerTransactionUrl(task.claimGenLayerTransactionHash) : null,
        submissionTransactionUrl: (isOwner || isWorker) ? explorerTransactionUrl(task.submission?.genlayerTransactionHash) : null,
        payoutTransactionUrl: (isOwner || isWorker) ? explorerTransactionUrl(task.payout?.genlayerTransactionHash) : null,
        recoveryTransactionUrl: isOwner ? explorerTransactionUrl(task.recovery?.genlayerTransactionHash) : null,
      },
    payout: trustedPayout,
    recovery: {
      eligible: task.recoveryEligible === true,
      deadline: task.recoveryDeadline || null,
      pending: task.recovery?.status === "pending",
      status: task.payout?.status === "refunded"
        ? "REFUNDED"
        : task.recovery?.status === "pending"
          ? "PENDING"
          : task.recoveryEligible === true
            ? (task.verification?.verdict === "REJECTED" ? "REJECTED" : "DEADLINE")
            : "NOT_ELIGIBLE",
    },
    verification: trustedVerification,
    canManage: Boolean(isOwner),
    canWork: Boolean(isWorker),
  };
  if ((isOwner || isWorker) && task.submission) safe.submission = task.submission;
  return safe;
}

function findTask(marketplace, id) {
  return marketplace.tasks.find((task) => task.id === id)
    || marketplace.tasks.find((task) => isOnChainTask(task) && String(task.chainTaskId) === String(id));
}

async function syncTaskTransactionReferences(task) {
  const references = [
    ["transactionHash", "genlayerTransactionHash"],
    ["claimTransactionHash", "claimGenLayerTransactionHash"],
    ["submission.transactionHash", "submission.genlayerTransactionHash"],
    ["payout.transactionHash", "payout.genlayerTransactionHash"],
  ];
  for (const [sourcePath, targetPath] of references) {
    const sourceParts = sourcePath.split(".");
    const targetParts = targetPath.split(".");
    const sourceParent = sourceParts.length === 2 ? task[sourceParts[0]] : task;
    const targetParent = targetParts.length === 2 ? task[targetParts[0]] : task;
    const sourceHash = sourceParent?.[sourceParts.at(-1)];
    if (!sourceHash || targetParent?.[targetParts.at(-1)]) continue;
    try {
      const genlayerHash = await getGenLayerTransactionHash(sourceHash);
      if (genlayerHash) targetParent[targetParts.at(-1)] = genlayerHash;
    } catch (error) {
      console.warn(`Unable to resolve GenLayer transaction ${sourceHash}:`, error.message);
    }
  }
}

async function syncTaskFromGenLayer(task) {
  if (!isOnChainTask(task)) return false;
  try {
    await syncTaskTransactionReferences(task);
    const [rawVerdict, payoutStatus, paid, refunded, claimed, worker, deadline, recoveryEligible, rawBounty] = await Promise.all([
      getVerdict(task.chainTaskId),
      getPayoutStatus(task.chainTaskId),
      isPaid(task.chainTaskId),
      isRefunded(task.chainTaskId),
      isClaimed(task.chainTaskId),
      getWorker(task.chainTaskId),
      getDeadline(task.chainTaskId),
      canRecover(task.chainTaskId),
      getBounty(task.chainTaskId),
    ]);
    const verdict = String(rawVerdict || "").trim().toUpperCase();
    const workerAddress = String(worker || "").trim();
    if (workerAddress && workerAddress.toLowerCase() !== ethers.ZeroAddress.toLowerCase()) task.claimedBy = normalizeWallet(workerAddress);
    task.recoveryDeadline = String(deadline || "");
    task.recoveryEligible = Boolean(recoveryEligible);
    task.bountyAmount = formatGenAmount(rawBounty);
    const checkedAt = new Date().toISOString();
    if (task.submission || verdict === "APPROVED" || verdict === "REJECTED") {
      task.verification = {
        status: verdict === "APPROVED" ? "approved" : verdict === "REJECTED" ? "rejected" : "pending",
        provider: "genlayer-bradbury",
        verdict: verdict || "UNDER_REVIEW",
        checkedAt,
      };
    } else {
      task.verification = null;
    }
    const normalizedPayoutStatus = String(payoutStatus || "UNAVAILABLE").trim().toUpperCase();
    task.payout = {
      ...(task.payout || {}),
      status: paid ? "paid" : refunded ? "refunded" : verdict === "APPROVED" ? "claimable" : normalizedPayoutStatus === "REJECTED" ? "rejected" : "escrowed",
      onChain: Boolean(paid || refunded),
      paidAt: paid ? (task.payout?.paidAt || checkedAt) : null,
      refundedAt: refunded ? (task.payout?.refundedAt || checkedAt) : null,
    };
    task.refunded = Boolean(refunded);
    reconcileFinalizedRecovery(task, refunded);
    task.status = paid
      ? "PAID"
      : verdict === "APPROVED"
        ? "APPROVED"
        : verdict === "REJECTED"
          ? "REJECTED"
          : task.submission
            ? "UNDER_REVIEW"
            : claimed || task.claimedBy
              ? "CLAIMED"
              : "OPEN";
    task.updatedAt = checkedAt;
    return true;
  } catch (error) {
    console.warn(`Unable to sync GenLayer state for task ${task.id}:`, error.message);
    return false;
  }
}

async function syncTasksFromGenLayer(tasks, marketplace = null) {
  await Promise.all(tasks.map((task) => syncTaskFromGenLayer(task)));
  if (marketplace) await saveMarketplace(marketplace);
  return tasks;
}

function createAuthMessage(wallet, nonce) {
  return [
    "Welcome to AnnotateX.",
    "",
    "Sign this message to authenticate your wallet.",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    "",
    "This signature does not authorize any blockchain transaction.",
  ].join("\n");
}

const authNonces = new Map();

function verifySignature(wallet, signature) {
  const normalizedWallet = validateWallet(wallet);
  const auth = authNonces.get(normalizedWallet);
  if (!auth || Date.now() - auth.createdAt > 5 * 60 * 1000) {
    authNonces.delete(normalizedWallet);
    throw new Error("Authentication request expired. Please connect and sign again.");
  }
  let recovered;
  try {
    recovered = normalizeWallet(ethers.verifyMessage(createAuthMessage(wallet, auth.nonce), signature));
  } catch {
    throw new Error("Invalid wallet signature");
  }
  if (recovered !== normalizedWallet) throw new Error("Wallet signature does not match the connected wallet");
  authNonces.delete(normalizedWallet);
  return normalizedWallet;
}

function establishSession(req, user, callback) {
  req.session.regenerate((regenerateError) => {
    if (regenerateError) return callback(regenerateError);
    req.session.user = sessionUser(user);
    return req.session.save(callback);
  });
}

async function findUserByWallet(wallet) {
  const normalizedWallet = normalizeWallet(wallet);
  const users = await readUsers();
  return users.find((user) => normalizeWallet(user.wallet) === normalizedWallet);
}

function respondWithUser(req, res, user, status = 200) {
  return establishSession(req, user, (error) => {
    if (error) return errorResponse(res, 500, "Unable to create authenticated session");
    return res.status(status).json({ success: true, user: req.session.user });
  });
}

app.post("/api/auth/nonce", (req, res) => {
  try {
    const wallet = validateWallet(req.body.wallet);
    const nonce = crypto.randomBytes(24).toString("hex");
    authNonces.set(wallet, { nonce, createdAt: Date.now() });
    return res.json({ success: true, wallet, message: createAuthMessage(req.body.wallet, nonce) });
  } catch (error) {
    return errorResponse(res, 400, error.message);
  }
});

app.post("/api/auth/verify", async (req, res) => {
  try {
    const wallet = verifySignature(req.body.wallet, req.body.signature);
    const user = await findUserByWallet(wallet);
    if (user) return respondWithUser(req, res, user);
    return res.json({ success: true, registered: false, wallet });
  } catch (error) {
    return errorResponse(res, 401, error.message);
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, wallet, role, signature } = req.body;
    const normalizedWallet = verifySignature(wallet, signature);
    const cleanUsername = validateUsername(username);
    const normalizedRole = validateRole(role);
    const users = await readUsers();
    if (users.some((user) => user.username.toLowerCase() === cleanUsername.toLowerCase())) {
      return errorResponse(res, 409, "Username is already taken");
    }
    if (users.some((user) => normalizeWallet(user.wallet) === normalizedWallet)) {
      return errorResponse(res, 409, "This wallet is already registered");
    }
    const user = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      wallet: normalizedWallet,
      role: normalizedRole,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await saveUsers(users);
    return respondWithUser(req, res, user, 201);
  } catch (error) {
    return errorResponse(res, 400, error.message);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const normalizedWallet = verifySignature(req.body.wallet, req.body.signature);
    const user = await findUserByWallet(normalizedWallet);
    if (!user) return errorResponse(res, 404, "No AnnotateX account is registered to this wallet");
    return respondWithUser(req, res, user);
  } catch (error) {
    return errorResponse(res, 401, error.message);
  }
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, authenticated: false });
  return res.json({ success: true, authenticated: true, user: req.session.user });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) return errorResponse(res, 500, "Logout failed");
    res.clearCookie("annotatex.sid");
    return res.json({ success: true });
  });
});

app.get("/api/config", (req, res) => {
  return res.json({
    success: true,
    blockchain: {
      configured: CONTRACT_CONFIGURED,
      contractAddress: CONTRACT_CONFIGURED ? process.env.GENLAYER_CONTRACT : null,
      chainId: process.env.GENLAYER_CHAIN_ID || "0x107d",
      chainName: "GenLayer Bradbury Testnet",
      rpcUrl: process.env.GENLAYER_RPC_URL || "https://rpc-bradbury.genlayer.com",
      explorerUrl: process.env.GENLAYER_EXPLORER_URL || "https://explorer-bradbury.genlayer.com/",
    },
  });
});

async function visibleTasksForRequest(req) {
  const marketplace = await readMarketplace();
  const viewer = req.session.user;
  if (viewer?.role === "client") {
    return syncTasksFromGenLayer(marketplace.tasks.filter((task) => isOnChainTask(task) && task.creatorWallet === normalizeWallet(viewer.wallet)), marketplace);
  }
  if (viewer?.role === "freelancer") return syncTasksFromGenLayer(marketplace.tasks.filter(isOnChainTask), marketplace);
  return marketplace.tasks.filter((task) => isOnChainTask(task) && taskStatus(task) === "OPEN");
}

app.get("/api/tasks", async (req, res) => {
  const tasks = (await visibleTasksForRequest(req)).map((task) => taskForViewer(task, req.session.user));
  return res.json({ success: true, count: tasks.length, tasks });
});

app.get("/api/tasks/available", async (req, res) => {
  const marketplace = await readMarketplace();
  const tasks = (await syncTasksFromGenLayer(marketplace.tasks.filter(isOnChainTask), marketplace))
    .filter((task) => taskStatus(task) === "OPEN")
    .map((task) => taskForViewer(task, req.session.user));
  return res.json({ success: true, count: tasks.length, tasks });
});

app.get("/api/tasks/mine", requireRole("client"), async (req, res) => {
  const wallet = normalizeWallet(req.session.user.wallet);
  const marketplace = await readMarketplace();
  const tasks = (await syncTasksFromGenLayer(marketplace.tasks
    .filter((task) => isOnChainTask(task) && task.creatorWallet === wallet), marketplace
  )).map((task) => taskForViewer(task, req.session.user));
  return res.json({ success: true, count: tasks.length, tasks });
});

app.get("/api/tasks/work", requireRole("freelancer"), async (req, res) => {
  const wallet = normalizeWallet(req.session.user.wallet);
  const marketplace = await readMarketplace();
  const tasks = (await syncTasksFromGenLayer(marketplace.tasks
    .filter((task) => isOnChainTask(task) && task.claimedBy === wallet), marketplace
  )).map((task) => taskForViewer(task, req.session.user));
  return res.json({ success: true, count: tasks.length, tasks });
});

app.get("/api/tasks/:id", async (req, res) => {
  const marketplace = await readMarketplace();
  const task = findTask(marketplace, req.params.id);
  if (!task) return errorResponse(res, 404, "Bounty not found");
  await syncTaskFromGenLayer(task);
  await saveMarketplace(marketplace);
  const viewer = req.session.user;
  if (viewer?.role === "client" && task.creatorWallet !== normalizeWallet(viewer.wallet)) {
    return errorResponse(res, 403, "You can only view your own bounties");
  }
  return res.json({ success: true, task: taskForViewer(task, viewer) });
});

app.post("/api/tasks/prepare", requireRole("client"), async (req, res) => {
  try {
    const { description, amount } = validateTaskInput(req.body.description ?? req.body.task, req.body.amount ?? req.body.bounty);
    const chainTaskId = CONTRACT_CONFIGURED ? String(await getTaskCount()) : null;
    const transaction = CONTRACT_CONFIGURED ? await prepareCreateTask(description, amount, req.session.user.wallet) : null;
    if (chainTaskId !== null) {
      pendingBountyPreparations.set(`${normalizeWallet(req.session.user.wallet)}:${chainTaskId}`, { description, amount, createdAt: Date.now() });
    }
    return res.json({ success: true, mode: transaction ? "onchain" : "local", transaction, chainTaskId, description, amount });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to prepare bounty transaction");
  }
});

app.post("/api/tasks/confirm", requireRole("client"), async (req, res) => {
  try {
    const { description, amount } = validateTaskInput(req.body.description ?? req.body.task, req.body.amount ?? req.body.bounty);
    const txHash = req.body.transactionHash ? String(req.body.transactionHash) : null;
    if (txHash && !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return errorResponse(res, 400, "Invalid transaction hash");
    if (CONTRACT_CONFIGURED && (!txHash || req.body.chainTaskId === null || req.body.chainTaskId === undefined)) return errorResponse(res, 503, "A Bradbury funding transaction and on-chain task id are required");
    const genlayerTransactionHash = txHash ? await getGenLayerTransactionHash(txHash) : null;
    if (CONTRACT_CONFIGURED && !genlayerTransactionHash) return errorResponse(res, 502, "The funding transaction was not accepted by the Bradbury consensus contract. No GenLayer transaction was created.");
    if (CONTRACT_CONFIGURED) {
      const chainTaskId = String(req.body.chainTaskId);
      const pending = pendingBountyPreparations.get(`${normalizeWallet(req.session.user.wallet)}:${chainTaskId}`);
      if (!pending || pending.description !== description || pending.amount !== amount || Date.now() - pending.createdAt > 15 * 60 * 1000) {
        return errorResponse(res, 409, "This bounty was not prepared by the authenticated client session");
      }
      pendingBountyPreparations.delete(`${normalizeWallet(req.session.user.wallet)}:${chainTaskId}`);
    }
    const marketplace = await readMarketplace();
    if (txHash) {
      const existing = marketplace.tasks.find((task) => task.transactionHash === txHash);
      if (existing) return res.status(200).json({ success: true, task: taskForViewer(existing, req.session.user) });
    }
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      chainTaskId: req.body.chainTaskId ?? null,
      contractAddress: CONTRACT_CONFIGURED ? normalizeWallet(process.env.GENLAYER_CONTRACT) : null,
      title: String(req.body.title || description.split(/[.!?]/)[0]).trim().slice(0, 90),
      description,
      bountyAmount: amount,
      asset: "GEN",
      creatorWallet: normalizeWallet(req.session.user.wallet),
      creatorUserId: req.session.user.id,
      status: "OPEN",
      claimedBy: null,
      claimedAt: null,
      submittedAt: null,
      submission: null,
      verification: null,
      transactionHash: txHash,
      genlayerTransactionHash,
      payout: { status: "escrowed", transactionHash: null, paidAt: null, onChain: false },
      createdAt: now,
      updatedAt: now,
    };
    marketplace.tasks.unshift(task);
    await saveMarketplace(marketplace);
    return res.status(201).json({ success: true, task: taskForViewer(task, req.session.user) });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to save bounty");
  }
});

app.post("/api/tasks/:id/claim/prepare", requireRole("freelancer"), async (req, res) => {
  try {
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    if (taskStatus(task) !== "OPEN") return errorResponse(res, 409, "This bounty is no longer available");
    if (CONTRACT_CONFIGURED && (task.chainTaskId === null || task.chainTaskId === undefined)) return errorResponse(res, 503, "This bounty is not linked to a Bradbury Intelligent Contract task");
    const transaction = CONTRACT_CONFIGURED ? await prepareClaimTask(task.chainTaskId, req.session.user.wallet) : null;
    return res.json({ success: true, mode: transaction ? "onchain" : "local", transaction });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to prepare claim transaction");
  }
});

app.post("/api/tasks/:id/claim", requireRole("freelancer"), async (req, res) => {
  const marketplace = await readMarketplace();
  const task = findTask(marketplace, req.params.id);
  if (!task) return errorResponse(res, 404, "Bounty not found");
  await syncTaskFromGenLayer(task);
  await saveMarketplace(marketplace);
  if (taskStatus(task) !== "OPEN") return errorResponse(res, 409, "This bounty has already been claimed");
  if (CONTRACT_CONFIGURED && !req.body.transactionHash) return errorResponse(res, 503, "The Bradbury claim transaction must be approved before recording the claim");
  const claimGenLayerTransactionHash = req.body.transactionHash ? await getGenLayerTransactionHash(String(req.body.transactionHash)) : null;
  if (CONTRACT_CONFIGURED && !claimGenLayerTransactionHash) return errorResponse(res, 502, "The claim transaction was not accepted by the Bradbury consensus contract. No GenLayer transaction was created.");
  const now = new Date().toISOString();
  task.claimedBy = normalizeWallet(req.session.user.wallet);
  task.claimedAt = now;
  task.claimTransactionHash = req.body.transactionHash || null;
  task.claimGenLayerTransactionHash = claimGenLayerTransactionHash;
  task.status = "CLAIMED";
  task.updatedAt = now;
  await saveMarketplace(marketplace);
  return res.json({ success: true, task: taskForViewer(task, req.session.user) });
});

app.post("/api/tasks/:id/submit/prepare", requireRole("freelancer"), async (req, res) => {
  try {
    const annotation = String(req.body.annotation || "").trim();
    if (annotation.length < 5 || annotation.length > 10000) return errorResponse(res, 400, "Submission must be between 5 and 10,000 characters");
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    if (task.claimedBy !== normalizeWallet(req.session.user.wallet)) return errorResponse(res, 403, "You can only submit work for a bounty you claimed");
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    if (taskStatus(task) !== "CLAIMED") return errorResponse(res, 409, "This bounty is not ready for a new submission");
    if (!CONTRACT_CONFIGURED || task.chainTaskId === null || task.chainTaskId === undefined) return errorResponse(res, 503, "GenLayer Bradbury verification is not configured for this bounty");
    const transaction = await prepareSubmitAnnotation(task.chainTaskId, annotation, req.session.user.wallet);
    return res.json({ success: true, mode: transaction ? "onchain" : "local", transaction });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to prepare submission transaction");
  }
});

app.post("/api/tasks/:id/submit", requireRole("freelancer"), async (req, res) => {
  try {
    const annotation = String(req.body.annotation || "").trim();
    if (annotation.length < 5 || annotation.length > 10000) return errorResponse(res, 400, "Submission must be between 5 and 10,000 characters");
    if (!CONTRACT_CONFIGURED || !req.body.transactionHash) return errorResponse(res, 503, "A Bradbury submission transaction is required before GenLayer can review this work");
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(req.body.transactionHash))) return errorResponse(res, 400, "Invalid submission transaction hash");
    const submissionGenLayerTransactionHash = await getGenLayerTransactionHash(String(req.body.transactionHash));
    if (!submissionGenLayerTransactionHash) return errorResponse(res, 502, "The submission transaction was not accepted by the Bradbury consensus contract. GenLayer review was not started.");
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    if (task.claimedBy !== normalizeWallet(req.session.user.wallet)) return errorResponse(res, 403, "You can only submit work for a bounty you claimed");
    if (taskStatus(task) !== "CLAIMED") return errorResponse(res, 409, "This bounty is not ready for a new submission");
    const now = new Date().toISOString();
    task.submission = { content: annotation, submittedBy: normalizeWallet(req.session.user.wallet), transactionHash: req.body.transactionHash || null, genlayerTransactionHash: submissionGenLayerTransactionHash };
    task.submittedAt = now;
    task.status = "UNDER_REVIEW";
    task.updatedAt = now;
    task.verification = { status: "pending", provider: "genlayer-bradbury", verdict: "UNDER_REVIEW", checkedAt: null };
    task.payout = { ...(task.payout || {}), status: "escrowed", onChain: false, transactionHash: null, paidAt: null };
    await saveMarketplace(marketplace);
    return res.json({ success: true, message: "Submission recorded. GenLayer validators are reviewing it.", task: taskForViewer(task, req.session.user) });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to submit work");
  }
});

app.get("/api/tasks/:id/verification", requireAuth, async (req, res) => {
  try {
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    const wallet = normalizeWallet(req.session.user.wallet);
    if (req.session.user.role === "client" && task.creatorWallet !== wallet) return errorResponse(res, 403, "You can only view your own bounties");
    if (req.session.user.role === "freelancer" && task.claimedBy !== wallet) return errorResponse(res, 403, "You can only view your claimed work");
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    return res.json({ success: true, task: taskForViewer(task, req.session.user) });
  } catch (error) {
    return errorResponse(res, 503, error.message || "GenLayer verification is unavailable");
  }
});

app.post("/api/tasks/:id/verify", requireRole("client"), (req, res) =>
  errorResponse(res, 410, "Verification is performed by the GenLayer Intelligent Contract; clients cannot approve submissions from the backend")
);

app.post("/api/tasks/:id/reward/prepare", requireRole("freelancer"), async (req, res) => {
  try {
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    if (task.claimedBy !== normalizeWallet(req.session.user.wallet)) return errorResponse(res, 403, "Only the assigned freelancer can claim this reward");
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    if (taskStatus(task) !== "APPROVED") return errorResponse(res, 409, "Reward is unavailable until GenLayer approves the submission");
    if (!CONTRACT_CONFIGURED || task.chainTaskId === null || task.chainTaskId === undefined) return errorResponse(res, 503, "This bounty is not linked to a Bradbury Intelligent Contract task");
    return res.json({ success: true, transaction: await prepareClaimReward(task.chainTaskId, req.session.user.wallet) });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to prepare reward claim");
  }
});

app.post("/api/tasks/:id/reward/confirm", requireRole("freelancer"), async (req, res) => {
  try {
    const hash = String(req.body.transactionHash || "");
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return errorResponse(res, 400, "A valid reward transaction hash is required");
    const payoutGenLayerTransactionHash = await getGenLayerTransactionHash(hash);
    if (!payoutGenLayerTransactionHash) return errorResponse(res, 502, "The payout transaction was not accepted by the Bradbury consensus contract. No payout transaction was created.");
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    if (task.claimedBy !== normalizeWallet(req.session.user.wallet)) return errorResponse(res, 403, "Only the assigned freelancer can claim this reward");
    task.payout = { ...(task.payout || {}), status: "pending", transactionHash: hash, genlayerTransactionHash: payoutGenLayerTransactionHash, onChain: false, paidAt: null };
    task.updatedAt = new Date().toISOString();
    await saveMarketplace(marketplace);
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    return res.json({ success: true, task: taskForViewer(task, req.session.user) });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to record reward transaction");
  }
});

app.post("/api/tasks/:id/recovery/prepare", requireRole("client"), async (req, res) => {
  try {
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    if (task.creatorWallet !== normalizeWallet(req.session.user.wallet)) return errorResponse(res, 403, "Only the task creator can recover this bounty");
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    if (!task.recoveryEligible) return errorResponse(res, 409, "This bounty is not yet eligible for recovery");
    if (!CONTRACT_CONFIGURED || task.chainTaskId === null || task.chainTaskId === undefined) return errorResponse(res, 503, "This bounty is not linked to a Bradbury Intelligent Contract task");
    return res.json({ success: true, transaction: await prepareRecoverBounty(task.chainTaskId, req.session.user.wallet) });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to prepare bounty recovery");
  }
});

app.post("/api/tasks/:id/recovery/confirm", requireRole("client"), async (req, res) => {
  try {
    const hash = String(req.body.transactionHash || "");
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return errorResponse(res, 400, "A valid recovery transaction hash is required");
    const recoveryGenLayerTransactionHash = await getGenLayerTransactionHash(hash);
    if (!recoveryGenLayerTransactionHash) return errorResponse(res, 502, "The recovery transaction was not accepted by the Bradbury consensus contract. No refund transaction was created.");
    const marketplace = await readMarketplace();
    const task = findTask(marketplace, req.params.id);
    if (!task) return errorResponse(res, 404, "Bounty not found");
    if (task.creatorWallet !== normalizeWallet(req.session.user.wallet)) return errorResponse(res, 403, "Only the task creator can recover this bounty");
    await syncTaskFromGenLayer(task);
    if (task.payout?.status === "paid" || task.payout?.status === "refunded") return errorResponse(res, 409, "This bounty has already been settled");
    task.recovery = { status: "pending", transactionHash: hash, genlayerTransactionHash: recoveryGenLayerTransactionHash };
    task.updatedAt = new Date().toISOString();
    await saveMarketplace(marketplace);
    await syncTaskFromGenLayer(task);
    await saveMarketplace(marketplace);
    return res.json({ success: true, task: taskForViewer(task, req.session.user) });
  } catch (error) {
    return errorResponse(res, 400, error.message || "Failed to record bounty recovery");
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return errorResponse(res, 500, "Unexpected server error");
});

async function start() {
  await persistence.init();
  app.listen(PORT, () => {
    console.log(`AnnotateX backend listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Unable to initialize AnnotateX persistence:", error);
  process.exitCode = 1;
});
