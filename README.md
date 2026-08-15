# AnnotateX

AnnotateX is a decentralized marketplace for AI and data annotation work. Clients create and fund bounties, freelancers complete them, and a GenLayer Intelligent Contract evaluates submitted work before a reward becomes claimable. Rejected or abandoned escrow can be recovered by the original client under contract-enforced rules.

## What problem it solves

Annotation marketplaces often rely on opaque review workflows and centralized payout decisions. AnnotateX makes the task brief, funding, claim, submission, verification verdict, and payout state explicit and auditable.

## Why GenLayer is necessary

The quality decision is not made by the Express server or a browser-side JavaScript shortcut. The deployed Intelligent Contract independently evaluates the freelancer submission and original client instructions in a nondeterministic leader/validator Equivalence-Principle path. Validator consensus stores `APPROVED` or `REJECTED` on-chain. Only an on-chain `APPROVED` verdict can call the payout function.

## Product flow

### Client

1. Connect a wallet on GenLayer Bradbury Testnet.
2. Create a bounty with task instructions and a GEN amount.
3. Approve the Bradbury consensus transaction in the wallet.
4. Monitor the bounty as `ACTIVE`, `SUBMITTED/PENDING VALIDATION`, `APPROVED`, `REJECTED`, `PAID`, or `REFUNDED`; recover eligible escrow from the client dashboard.

### Freelancer

1. Connect the wallet linked to the freelancer account.
2. Browse funded `OPEN` bounties.
3. Claim a bounty and submit the completed work once.
4. Follow the GenLayer Explorer transaction while consensus is pending.
5. Claim the reward only after the on-chain verdict is `APPROVED`.

### GenLayer verification and payout

`submit_annotation(task_id, annotation)` independently evaluates the stored original instructions and submitted work on the leader and validators. The contract stores the consensus result only after the verdict field agrees. `claim_reward(task_id)` is the only worker payout path and requires the assigned worker, a submitted task, `APPROVED`, and an unpaid/unrefunded bounty. `recover_bounty(task_id)` can refund the creator after rejection or a safe deadline, with double payout/refund prevented on-chain.

## Architecture

```text
Browser wallet
    |
    v
Frontend dashboards -- same-origin API --> Express backend
                                               |
                                               v
                                      GenLayerJS / Bradbury RPC
                                               |
                                               v
                              AnnotateX Intelligent Contract
                                               |
                                               v
                                      GenLayer validators
```

The browser approves wallet transactions. The backend prepares calldata, enforces authentication and authorization, reads Bradbury state, and never holds a private key.

## Tech stack

- Static HTML, CSS, and browser JavaScript frontend
- Node.js and Express backend
- `express-session` HTTP-only cookie sessions
- `genlayer-js` and `viem` for Bradbury contract integration
- Python GenLayer Intelligent Contract
- JSON persistence for the current MVP

## Bradbury network

- Network: GenLayer Bradbury Testnet
- Chain ID: `4221` (`0x107d`)
- GenLayer RPC: `https://rpc-bradbury.genlayer.com`
- Explorer: `https://explorer-bradbury.genlayer.com/`
- Existing deployed AnnotateX contract: `0x63E06B5a9200d737ED6148607110B64356220015` (legacy build; redeploy this updated contract before using recovery)
- Consensus main contract used for Intelligent Contract transactions: `0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D`

The contract address is public configuration, not a secret. The production deployment is configured to use this Bradbury contract; verify it when configuring another environment.

## Local setup

Requirements: Node.js 20 or newer, a Bradbury-compatible wallet, and Bradbury GEN for test transactions.

```powershell
Set-Location "C:\Users\USER\OneDrive\Documents\AnnotateX\annotatex-backend"
npm.cmd install
Copy-Item .env.example .env
```

Set `GENLAYER_CONTRACT` in `.env` to the deployed Bradbury address. For local development, `SESSION_SECRET` may be omitted because the server generates a temporary secret; production must set a durable secret of at least 32 characters.

Start the application:

```powershell
npm.cmd start
```

Open `http://localhost:4000`. Development mode with automatic Node watching is available through:

```powershell
npm.cmd run dev
```

Run checks and tests:

```powershell
npm.cmd test
```

## Environment variables

Use [`.env.example`](.env.example) or [`annotatex-backend/.env.example`](annotatex-backend/.env.example) as the placeholder template.

- `NODE_ENV`: `development` or `production`
- `PORT`: hosting provider port, default `4000`
- `FRONTEND_ORIGINS`: comma-separated allowed browser origins; required in production
- `SESSION_SECRET`: long random session secret; required in production
- `GENLAYER_CONTRACT`: address of the newly deployed updated Bradbury contract; required in production
- `GENLAYER_CHAIN_ID`: `0x107d`
- `GENLAYER_RPC_URL`: Bradbury RPC URL used for deployment/configuration documentation
- `GENLAYER_EXPLORER_URL`: Bradbury Explorer base URL
- `ANNOTATEX_DATA_DIR`: optional directory for MVP JSON persistence

## Deployment and production notes

The current production deployment is available at [annotatex.onrender.com](https://annotatex.onrender.com/). It runs the backend as one Node web service that serves both the static frontend and `/api/*`, keeping authentication same-origin and avoiding cross-site cookie complexity.

The current MVP uses a JSON file store. A persistent disk is required for user and marketplace data to survive a restart or redeploy; an ephemeral filesystem will lose `users.json` and `marketplace.json`.

Recommended MVP configuration:

- Root/service directory: `annotatex-backend`
- Build command: `npm ci`
- Start command: `npm start`
- Node version: `20.x` or newer
- Persistent data directory: set `ANNOTATEX_DATA_DIR` to a mounted volume
- Production `FRONTEND_ORIGINS`: the deployed HTTPS origin
- Production `SESSION_SECRET`: a secret configured in the host, never committed
- Production `GENLAYER_CONTRACT`: the Bradbury contract address

Render with a persistent disk or Fly.io with a mounted volume are suitable for this file-backed MVP. For future scale, replace the JSON store with a managed database; that remains outside the current release.

## Security notes

- Wallet signatures authenticate accounts; the session is held in an HTTP-only cookie.
- Backend role checks and wallet ownership checks protect client and freelancer routes.
- Browser code contains no private keys or session secrets.
- The backend does not sign blockchain transactions.
- Production requires `SESSION_SECRET`, `GENLAYER_CONTRACT`, and `FRONTEND_ORIGINS`.
- `.env`, local users, marketplace data, logs, and dependencies are ignored by Git.
- Never commit a deployer keystore, private key, wallet seed phrase, or production secret.

## Known MVP limitations

- Persistence is JSON-file based and requires a persistent hosting volume.
- Sessions use the default in-memory session store; use a shared session store for multiple backend instances.
- The landing page contains clearly labeled static marketplace preview cards; dashboard counts and earnings are data-driven.
- The contract and UI support one submission per bounty and one payout per approved bounty.
- Contract consensus can take time or return an undetermined/error result; the UI exposes pending/error states and Explorer links where a real GenLayer transaction exists.
- A contract upgrade is not automatic; existing funds/tasks remain governed by the legacy deployed address until a new contract is deployed and configured.

## Demo and screenshots

- Live demo: [https://annotatex.onrender.com/](https://annotatex.onrender.com/)
- Product walkthrough: **Coming soon**
- Screenshots: **Coming soon**

## GenLayer Builders Program submission checklist

- [x] Deploy the backend and publish the live Render URL.
- [x] Configure production environment variables in the hosting provider.
- [x] Deploy the AnnotateX Intelligent Contract on GenLayer Bradbury Testnet.
- [x] Connect the production application to the deployed Bradbury contract.
- [x] Capture the funding, claim, submission/consensus, and payout Explorer links.
- [x] Add the live URL above.
- [ ] Optionally add screenshots or a product walkthrough; neither is required for the application to be functional or for this README to document the deployed project.
- [x] Run a fresh Bradbury end-to-end test with separate client and freelancer wallets.
- [x] Submit the public GitHub repository and this README.
