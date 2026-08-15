"""Executable Direct Mode tests for the AnnotateX Intelligent Contract.

Install the official GenLayer test suite first:
    pip install genlayer-test

Run from the repository root:
    pytest annotatex-contract/tests/test_submission_flow.py -q

The tests mock only the nondeterministic model transport. Every verdict is
produced by submit_annotation's leader/validator Equivalence-Principle path,
and every payout/refund assertion calls the real contract methods.
"""

import os
import tempfile
from pathlib import Path

CONTRACT = str(Path(__file__).parents[1] / "AnnotateXBounty.py")
TASK = "Return a JSON array of all labels in the supplied dataset, preserving order."
CORRECT = '["cat", "dog", "bird"]'
WRONG = "This is an unrelated paragraph about the weather."
BOUNTY = 10**18
GENVM_SDK_VERSION = "v0.2.12"


def _patch_windows_direct_loader():
    """Work around genlayer-test's open-temp-file cleanup on Windows.

    Direct Mode keeps the injected stdin descriptor open until the VM context
    is deactivated. Windows therefore rejects the loader's immediate unlink.
    This test-only shim defers that unlink until the loader restores stdin.
    """
    if os.name != "nt":
        return

    import gltest.direct.loader as loader
    import gltest.direct.vm as direct_vm_module

    if getattr(loader, "_annotatex_windows_patched", False):
        return

    def inject_message_to_fd0(vm):
        from genlayer.py import calldata
        from genlayer.py.types import Address

        sender_addr = vm.sender
        if isinstance(sender_addr, bytes):
            sender_addr = Address(sender_addr)

        contract_addr = vm._contract_address
        if isinstance(contract_addr, bytes):
            contract_addr = Address(contract_addr)

        origin_addr = vm.origin
        if isinstance(origin_addr, bytes):
            origin_addr = Address(origin_addr)

        message_data = {
            "contract_address": contract_addr,
            "sender_address": sender_addr,
            "origin_address": origin_addr,
            "stack": [],
            "value": vm._value,
            "datetime": vm._datetime,
            "is_init": False,
            "chain_id": vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }

        encoded = calldata.encode(message_data)
        fd, path = tempfile.mkstemp()
        try:
            os.write(fd, encoded)
            os.lseek(fd, 0, os.SEEK_SET)
            vm._original_stdin_fd = os.dup(0)
            os.dup2(fd, 0)
            vm._annotatex_stdin_temp_path = path
        except Exception:
            try:
                os.unlink(path)
            except OSError:
                pass
            raise
        finally:
            os.close(fd)

    original_cleanup = direct_vm_module.VMContext._cleanup_after_deactivate

    def cleanup_after_deactivate(vm):
        path = getattr(vm, "_annotatex_stdin_temp_path", None)
        try:
            original_cleanup(vm)
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    loader._inject_message_to_fd0 = inject_message_to_fd0
    direct_vm_module.VMContext._cleanup_after_deactivate = cleanup_after_deactivate
    loader._annotatex_windows_patched = True


_patch_windows_direct_loader()


def make_task(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT, sdk_version=GENVM_SDK_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.value = BOUNTY
    contract.create_task(TASK)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    contract.claim_task(0)
    return contract


def mock_verdict(direct_vm, verdict):
    direct_vm.mock_llm(
        r"ORIGINAL CLIENT INSTRUCTIONS",
        '{"verdict": "' + verdict + '", "reasoning": "test model result"}',
    )


def test_correct_submission_is_approved_and_claimable(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = make_task(direct_vm, direct_deploy, direct_alice, direct_bob)
    mock_verdict(direct_vm, "APPROVED")

    contract.submit_annotation(0, CORRECT)

    assert contract.get_verdict(0) == "APPROVED"
    assert contract.get_payout_status(0) == "CLAIMABLE"
    assert contract.is_paid(0) is False

    direct_vm.sender = direct_bob
    contract.claim_reward(0)
    assert contract.is_paid(0) is True
    assert contract.get_payout_status(0) == "PAID"

    with direct_vm.expect_revert("Reward already paid"):
        contract.claim_reward(0)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("A paid bounty cannot be refunded"):
        contract.recover_bounty(0)


def test_irrelevant_submission_is_rejected_and_cannot_be_paid(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = make_task(direct_vm, direct_deploy, direct_alice, direct_bob)
    mock_verdict(direct_vm, "REJECTED")

    contract.submit_annotation(0, WRONG)

    assert contract.get_verdict(0) == "REJECTED"
    assert contract.get_payout_status(0) == "REJECTED"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Reward is available only after approval"):
        contract.claim_reward(0)


def test_rejected_bounty_can_be_recovered_once_by_creator(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = make_task(direct_vm, direct_deploy, direct_alice, direct_bob)
    mock_verdict(direct_vm, "REJECTED")
    contract.submit_annotation(0, WRONG)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the task creator can recover the bounty"):
        contract.recover_bounty(0)

    direct_vm.sender = direct_alice
    assert contract.can_recover(0) is True
    contract.recover_bounty(0)
    assert contract.is_refunded(0) is True
    assert contract.get_payout_status(0) == "REFUNDED"

    with direct_vm.expect_revert("Bounty already refunded"):
        contract.recover_bounty(0)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Bounty has been refunded"):
        contract.claim_reward(0)


def test_unexpired_abandoned_bounty_cannot_be_recovered(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT, sdk_version=GENVM_SDK_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.value = BOUNTY
    contract.create_task(TASK)
    direct_vm.value = 0

    assert contract.can_recover(0) is False
    with direct_vm.expect_revert("Bounty is not yet eligible for recovery"):
        contract.recover_bounty(0)


def test_abandoned_bounty_becomes_recoverable_after_deadline(direct_vm, direct_deploy, direct_alice):
    direct_vm.warp("2026-01-01T00:00:00Z")
    contract = direct_deploy(CONTRACT, sdk_version=GENVM_SDK_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.value = BOUNTY
    contract.create_task(TASK)
    direct_vm.value = 0

    direct_vm.warp("2026-01-09T00:00:00Z")
    assert contract.can_recover(0) is True
    contract.recover_bounty(0)
    assert contract.is_refunded(0) is True
    assert contract.get_payout_status(0) == "REFUNDED"
