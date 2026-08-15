# AnnotateX Intelligent Contract

`AnnotateXBounty.py` is the Bradbury Testnet contract for the secure bounty lifecycle.

1. `create_task(task)` is payable and escrows GEN.
2. `claim_task(task_id)` assigns the worker once.
3. `submit_annotation(task_id, annotation)` runs an independent leader/validator evaluation inside `gl.vm.run_nondet_unsafe`, GenLayer's Equivalence-Principle execution path. Both model executions return a structured verdict and validators must agree on its `verdict` field before the contract stores `APPROVED` or `REJECTED`.
4. `claim_reward(task_id)` is the worker payout function. It requires the assigned worker, an on-chain `APPROVED` verdict, and an unpaid/unrefunded bounty, then emits the GEN transfer and marks the bounty paid.
5. `recover_bounty(task_id)` is restricted to the task creator. It refunds escrow immediately after a consensus `REJECTED` verdict, or after the deterministic deadline for an unclaimed/abandoned task. It cannot run after approval, payout, or an earlier refund.

Deadlines are seven days for an unclaimed bounty and fourteen days after a worker claims it. GenLayer transaction timestamps are used so validators see identical deadline calculations.

Deploy to Bradbury:

```powershell
Set-Location "C:\Users\USER\OneDrive\Documents\AnnotateX"
genlayer network set testnet-bradbury
genlayer deploy --contract ".\annotatex-contract\AnnotateXBounty.py"
```

Run the command from the AnnotateX project directory, or use the absolute contract path. The deployer account must also have Bradbury GEN; verify it with `genlayer account show --account annotatex-deployer` before deploying.

Set the resulting address in `annotatex-backend/.env` as `GENLAYER_CONTRACT`. The backend intentionally refuses to submit or prepare a reward for a bounty that is not linked to a deployed Bradbury contract.

The contract tests in `tests/test_submission_flow.py` cover approval and claim, rejection and blocked claim, creator-only recovery, double-settlement guards, and abandoned-task recovery after a warped deadline. They use GenLayer's official VM mock only to make the nondeterministic model transport reproducible; production verdicts come from the leader/validator consensus path on-chain.
