# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""AnnotateX bounty escrow and GenLayer consensus evaluator.

Deploy this Intelligent Contract to GenLayer Bradbury Testnet and set its
address in annotatex-backend/.env as GENLAYER_CONTRACT.

The contract deliberately separates submission/evaluation from payout:
submit_annotation() stores the submission and the consensus verdict, but it
never transfers GEN. claim_reward() is the only payout function and requires
an APPROVED verdict.
"""

from dataclasses import dataclass

from genlayer import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")


@allow_storage
@dataclass
class Bounty:
    creator: Address
    instructions: str
    amount: u256
    worker: Address
    claimed: bool
    submitted: bool
    submission: str
    verdict: str
    paid: bool


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class AnnotateXBounty(gl.Contract):
    tasks: TreeMap[u256, Bounty]
    task_count: u256

    def __init__(self):
        self.tasks = TreeMap()
        self.task_count = u256(0)

    @gl.public.write.payable
    def create_task(self, task: str) -> None:
        if len(task.strip()) < 20:
            raise gl.vm.UserError("Task instructions are too short")
        if gl.message.value == u256(0):
            raise gl.vm.UserError("A bounty must fund the task")

        self.tasks[self.task_count] = Bounty(
            creator=gl.message.sender_address,
            instructions=task,
            amount=gl.message.value,
            worker=ZERO_ADDRESS,
            claimed=False,
            submitted=False,
            submission="",
            verdict="OPEN",
            paid=False,
        )
        self.task_count += u256(1)

    @gl.public.write
    def claim_task(self, task_id: u256) -> None:
        self._require_task(task_id)
        task = self.tasks[task_id]
        if task.claimed:
            raise gl.vm.UserError("Bounty already claimed")
        if task.paid or task.submitted:
            raise gl.vm.UserError("Bounty is no longer open")
        if gl.message.sender_address == task.creator:
            raise gl.vm.UserError("The client cannot claim its own bounty")

        task.worker = gl.message.sender_address
        task.claimed = True
        task.verdict = "CLAIMED"
        self.tasks[task_id] = task

    @gl.public.write
    def submit_annotation(self, task_id: u256, annotation: str) -> None:
        """Submit once and evaluate against the original instructions.

        Validators do not compare arbitrary LLM strings. The non-comparative
        Equivalence Principle asks each validator to judge the leader result
        against the same task instructions, submission, and criteria. The
        accepted canonical result is stored on-chain only after consensus.
        """
        self._require_task(task_id)
        task = self.tasks[task_id]
        if not task.claimed or task.worker != gl.message.sender_address:
            raise gl.vm.UserError("Only the assigned worker can submit")
        if task.submitted:
            raise gl.vm.UserError("A bounty accepts only one submission")
        if len(annotation.strip()) < 5:
            raise gl.vm.UserError("Submission is too short")

        instructions = task.instructions

        def get_submission() -> str:
            return (
                "ORIGINAL CLIENT INSTRUCTIONS:\n"
                + instructions
                + "\n\nFREELANCER SUBMISSION:\n"
                + annotation
            )

        result = gl.eq_principle.prompt_non_comparative(
            get_submission,
            task=(
                "Evaluate whether the freelancer submission satisfies the original "
                "client instructions. Return exactly APPROVED or REJECTED."
            ),
            criteria=(
                "APPROVED only when the submission is materially complete, directly "
                "relevant to the original instructions, and provides the requested "
                "deliverable or evidence. REJECTED when it is random, unrelated, "
                "incomplete, a placeholder/link without the requested work, or fails "
                "any explicit requirement. Judge the submission against the original "
                "instructions, not against whether it is merely non-empty. Return only "
                "APPROVED or REJECTED."
            ),
        )

        normalized = str(result).strip().upper()
        verdict = "APPROVED" if normalized == "APPROVED" else "REJECTED"
        task.submission = annotation
        task.submitted = True
        task.verdict = verdict
        self.tasks[task_id] = task

    @gl.public.write
    def claim_reward(self, task_id: u256) -> None:
        """Transfer escrowed GEN only after an approved consensus verdict."""
        self._require_task(task_id)
        task = self.tasks[task_id]
        if task.worker != gl.message.sender_address:
            raise gl.vm.UserError("Only the assigned worker can claim the reward")
        if not task.submitted or task.verdict != "APPROVED":
            raise gl.vm.UserError("Reward is available only after approval")
        if task.paid:
            raise gl.vm.UserError("Reward already paid")

        # EOA payouts are external messages and are finalized by GenLayer.
        _Recipient(task.worker).emit_transfer(value=task.amount)
        task.paid = True
        self.tasks[task_id] = task

    @gl.public.view
    def get_task_count(self) -> u256:
        return self.task_count

    @gl.public.view
    def get_task(self, task_id: u256) -> str:
        self._require_task(task_id)
        return self.tasks[task_id].instructions

    @gl.public.view
    def get_task_creator(self, task_id: u256) -> Address:
        self._require_task(task_id)
        return self.tasks[task_id].creator

    @gl.public.view
    def get_bounty(self, task_id: u256) -> u256:
        self._require_task(task_id)
        return self.tasks[task_id].amount

    @gl.public.view
    def has_submitted(self, task_id: u256) -> bool:
        self._require_task(task_id)
        return self.tasks[task_id].submitted

    @gl.public.view
    def get_verdict(self, task_id: u256) -> str:
        self._require_task(task_id)
        return self.tasks[task_id].verdict

    @gl.public.view
    def get_submission(self, task_id: u256) -> str:
        self._require_task(task_id)
        return self.tasks[task_id].submission

    @gl.public.view
    def get_worker(self, task_id: u256) -> Address:
        self._require_task(task_id)
        return self.tasks[task_id].worker

    @gl.public.view
    def is_claimed(self, task_id: u256) -> bool:
        self._require_task(task_id)
        return self.tasks[task_id].claimed

    @gl.public.view
    def is_paid(self, task_id: u256) -> bool:
        self._require_task(task_id)
        return self.tasks[task_id].paid

    @gl.public.view
    def get_payout_status(self, task_id: u256) -> str:
        self._require_task(task_id)
        task = self.tasks[task_id]
        if task.paid:
            return "PAID"
        if task.verdict == "APPROVED":
            return "CLAIMABLE"
        return "UNAVAILABLE"

    def _require_task(self, task_id: u256) -> None:
        if task_id >= self.task_count:
            raise gl.vm.UserError("Bounty not found")
