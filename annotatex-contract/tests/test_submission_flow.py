"""GenLayer contract tests.

Run after installing the official GenLayer test suite:
    pip install genlayer-test
    pytest annotatex-contract/tests/test_submission_flow.py -q

These tests mock only the LLM response inside GenLayer's test VM. Production
verification still happens only through prompt_non_comparative and validator
consensus in the Intelligent Contract.
"""

from pathlib import Path

import pytest

try:
    from gltest import deploy_contract
except ImportError:  # Keep the repository's normal JS test command usable.
    deploy_contract = None


CONTRACT = Path(__file__).parents[1] / "AnnotateXBounty.py"
TASK = "Return a JSON array of all labels in the supplied dataset, preserving order."
CORRECT = '["cat", "dog", "bird"]'
WRONG = "https://example.invalid/random-link"


@pytest.mark.skipif(deploy_contract is None, reason="install genlayer-test to run Intelligent Contract tests")
def test_correct_submission_is_approved(direct_vm, direct_alice, direct_bob):
    contract = deploy_contract(CONTRACT, direct_vm)
    direct_vm.sender = direct_alice
    contract.create_task(TASK, value=10**18)
    direct_vm.sender = direct_bob
    contract.claim_task(0)
    direct_vm.mock_llm(r"Evaluate whether.*", "APPROVED")
    contract.submit_annotation(0, CORRECT)
    assert contract.get_verdict(0) == "APPROVED"
    assert contract.is_paid(0) is False


@pytest.mark.skipif(deploy_contract is None, reason="install genlayer-test to run Intelligent Contract tests")
def test_wrong_submission_is_rejected_and_cannot_be_paid(direct_vm, direct_alice, direct_bob):
    contract = deploy_contract(CONTRACT, direct_vm)
    direct_vm.sender = direct_alice
    contract.create_task(TASK, value=10**18)
    direct_vm.sender = direct_bob
    contract.claim_task(0)
    direct_vm.mock_llm(r"Evaluate whether.*", "REJECTED")
    contract.submit_annotation(0, WRONG)
    assert contract.get_verdict(0) == "REJECTED"
    with direct_vm.expect_revert("Reward is available only after approval"):
        contract.claim_reward(0)
