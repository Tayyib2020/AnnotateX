# AnnotateX Intelligent Contract

`AnnotateXBounty.py` is the Bradbury Testnet contract for the secure bounty lifecycle.

1. `create_task(task)` is payable and escrows GEN.
2. `claim_task(task_id)` assigns the worker once.
3. `submit_annotation(task_id, annotation)` evaluates the annotation against the stored client instructions using `gl.eq_principle.prompt_non_comparative`. It stores only the consensus verdict (`APPROVED` or `REJECTED`) and never transfers GEN.
4. `claim_reward(task_id)` is the only payout function. It requires `APPROVED`, the original worker, and `paid == False`, then emits the finalized GEN transfer and marks the bounty paid.

Deploy to Bradbury:

```powershell
Set-Location "C:\Users\USER\OneDrive\Documents\AnnotateX"
genlayer network set testnet-bradbury
genlayer deploy --contract ".\annotatex-contract\AnnotateXBounty.py"
```

Run the command from the AnnotateX project directory, or use the absolute contract path. The deployer account must also have Bradbury GEN; verify it with `genlayer account show --account annotatex-deployer` before deploying.

Set the resulting address in `annotatex-backend/.env` as `GENLAYER_CONTRACT`. The backend intentionally refuses to submit or prepare a reward for a bounty that is not linked to a deployed Bradbury contract.

The contract tests in `tests/test_submission_flow.py` cover a clearly correct submission and a clearly wrong/random submission. They use GenLayer's official VM mock only to control the LLM response in tests; production verdicts come from validator consensus on-chain.
