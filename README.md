# AnnotateX

AnnotateX is a decentralized marketplace for AI and data annotation work. Clients create and fund bounties, freelancers complete them, and a GenLayer Intelligent Contract evaluates submitted work before a reward becomes claimable.

## What problem it solves

Annotation marketplaces often rely on opaque review workflows and centralized payout decisions. AnnotateX makes the task brief, funding, claim, submission, verification verdict, and payout state explicit and auditable.

## Why GenLayer is necessary

The quality decision is not made by the Express server or a browser-side JavaScript shortcut. The deployed Intelligent Contract compares the freelancer submission with the original client instructions using GenLayer's non-deterministic AI evaluation and Equivalence Principle. Validator consensus stores `APPROVED` or `REJECTED` on-chain. Only `APPROVED` work can call the payout function.

## Product flow

### Client

1. Connect a wallet on GenLayer Bradbury Testnet.
2. Create a bounty with task instructions and a GEN amount.
3. Approve the Bradbury consensus transaction in the wallet.
4. Monitor the bounty as `OPEN`, `CLAIMED`, `UNDER REVIEW`, `APPROVED`, `REJECTED`, or `PAID`.

### Freelancer

1. Connect the wallet linked to the freelancer account.
2. Browse funded `OPEN` bounties.
3. Claim a bounty and submit the completed work once.
4. Follow the GenLayer Explorer transaction while consensus is pending.
5. Claim the reward only after the on-chain verdict is `APPROVED`.

### GenLayer verification and payout

`submit_annotation(task_id, annotation)` evaluates the stored original instructions and the submitted work. The contract stores the canonical verdict after consensus. `claim_reward(task_id)` is the only payout path and requires the assigned worker, a submitted task, `APPROVED`, and an unpaid bounty.

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
- Current deployed AnnotateX contract: `0x63E06B5a9200d737ED6148607110B64356220015`
- Consensus main contract used for Intelligent Contract transactions: `0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D`

The contract address is public configuration, not a secret. Verify it against the intended Bradbury deployment before a public launch.

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
- `GENLAYER_CONTRACT`: deployed Bradbury contract address; required in production
- `GENLAYER_CHAIN_ID`: `0x107d`
- `GENLAYER_RPC_URL`: Bradbury RPC URL used for deployment/configuration documentation
- `GENLAYER_EXPLORER_URL`: Bradbury Explorer base URL
- `ANNOTATEX_DATA_DIR`: optional directory for MVP JSON persistence

## Deployment recommendation

Deploy the backend as one Node web service that serves both the static frontend and `/api/*`. This keeps authentication same-origin and avoids cross-site cookie complexity. A host with a persistent disk is required for the current JSON store; an ephemeral filesystem will lose `users.json` and `marketplace.json` on restart or redeploy.

Recommended MVP configuration:

- Root/service directory: `annotatex-backend`
- Build command: `npm ci`
- Start command: `npm start`
- Node version: `20.x` or newer
- Persistent data directory: set `ANNOTATEX_DATA_DIR` to a mounted volume
- Production `FRONTEND_ORIGINS`: the deployed HTTPS origin
- Production `SESSION_SECRET`: a secret configured in the host, never committed
- Production `GENLAYER_CONTRACT`: the Bradbury contract address

Render with a persistent disk or Fly.io with a mounted volume are suitable for this file-backed MVP. For a more durable public service, replace the JSON store with a managed database in a later iteration; that is intentionally outside this release-preparation pass.

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

## Demo and screenshots

- Live demo: **to be deployed**
- Product walkthrough: **to be recorded**
- Screenshots: **to be added soon**

## GenLayer Builders Program submission checklist

- [ ] Deploy the backend with persistent storage.
- [ ] Set production environment variables in the hosting provider.
- [ ] Run a fresh Bradbury end-to-end test with separate client and freelancer wallets.
- [ ] Capture the funding, claim, submission/consensus, and payout Explorer links.
- [ ] Add the live URL and screenshots above.
- [ ] Submit the public GitHub repository and this README.
