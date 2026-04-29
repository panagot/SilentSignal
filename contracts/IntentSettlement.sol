// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IntentSettlement is EIP712, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant INTENT_TYPEHASH =
        keccak256(
            "Intent(address maker,address tokenOut,uint256 maxInputWei,uint256 minOutputTokens,uint256 expiry,uint256 nonce,bool allowPartial)"
        );

    struct Intent {
        address maker;
        address tokenOut;
        uint256 maxInputWei;
        uint256 minOutputTokens;
        uint256 expiry;
        uint256 nonce;
        bool allowPartial;
    }

    struct Lock {
        uint256 amount;
        uint256 expiry;
        bytes32 intentHash;
    }

    mapping(address => mapping(uint256 => Lock)) public locks;
    mapping(address => bool) public solverAllowlist;
    bool public enforceSolverAllowlist;

    event IntentLocked(
        address indexed maker,
        uint256 indexed nonce,
        uint256 amount,
        uint256 expiry,
        bytes32 intentHash
    );
    event IntentFilled(
        address indexed maker,
        address indexed solver,
        uint256 indexed nonce,
        uint256 amountInWei,
        uint256 amountOutTokens
    );
    event IntentCancelled(address indexed maker, uint256 indexed nonce, uint256 refundedWei);
    event SolverAllowlistUpdated(address indexed solver, bool allowed);
    event EnforceAllowlistUpdated(bool enabled);

    constructor(address owner_) EIP712("SilentSignalIntent", "1") Ownable(owner_) {}

    function hashIntentStruct(Intent calldata intent) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    INTENT_TYPEHASH,
                    intent.maker,
                    intent.tokenOut,
                    intent.maxInputWei,
                    intent.minOutputTokens,
                    intent.expiry,
                    intent.nonce,
                    intent.allowPartial
                )
            );
    }

    function lockIntent(bytes32 intentHash, uint256 nonce, uint256 expiry) external payable {
        require(msg.value > 0, "lock value zero");
        require(expiry > block.timestamp, "expiry in past");

        Lock storage existing = locks[msg.sender][nonce];
        require(existing.amount == 0, "nonce already locked");

        locks[msg.sender][nonce] = Lock({amount: msg.value, expiry: expiry, intentHash: intentHash});
        emit IntentLocked(msg.sender, nonce, msg.value, expiry, intentHash);
    }

    function cancelLock(uint256 nonce) external {
        Lock memory lockData = locks[msg.sender][nonce];
        require(lockData.amount > 0, "no lock");
        delete locks[msg.sender][nonce];
        (bool ok, ) = payable(msg.sender).call{value: lockData.amount}("");
        require(ok, "refund failed");
        emit IntentCancelled(msg.sender, nonce, lockData.amount);
    }

    function fillIntent(
        Intent calldata intent,
        uint256 amountInWei,
        uint256 amountOutTokens,
        bytes calldata signature
    ) external {
        if (enforceSolverAllowlist) {
            require(solverAllowlist[msg.sender], "solver not allowlisted");
        }
        require(block.timestamp <= intent.expiry, "intent expired");

        Lock memory lockData = locks[intent.maker][intent.nonce];
        require(lockData.amount > 0, "intent not locked");
        require(block.timestamp <= lockData.expiry, "lock expired");
        require(amountInWei > 0 && amountInWei <= lockData.amount, "invalid amountIn");
        require(amountInWei <= intent.maxInputWei, "exceeds max input");
        require(amountOutTokens > 0, "amountOut zero");

        bytes32 structHash = hashIntentStruct(intent);
        require(lockData.intentHash == structHash, "intent hash mismatch");

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);
        require(recoveredSigner == intent.maker, "bad signature");

        uint256 minOutScaled = intent.allowPartial
            ? (intent.minOutputTokens * amountInWei) / intent.maxInputWei
            : intent.minOutputTokens;
        require(amountOutTokens >= minOutScaled, "min output not met");

        // Solver transfers tokenOut directly to maker.
        require(IERC20(intent.tokenOut).transferFrom(msg.sender, intent.maker, amountOutTokens), "token transfer failed");

        uint256 remaining = lockData.amount - amountInWei;
        if (!intent.allowPartial || remaining == 0) {
            delete locks[intent.maker][intent.nonce];
            if (remaining > 0) {
                (bool refunded, ) = payable(intent.maker).call{value: remaining}("");
                require(refunded, "refund failed");
            }
        } else {
            locks[intent.maker][intent.nonce].amount = remaining;
        }

        (bool paid, ) = payable(msg.sender).call{value: amountInWei}("");
        require(paid, "solver payment failed");

        emit IntentFilled(intent.maker, msg.sender, intent.nonce, amountInWei, amountOutTokens);
    }

    function setSolverAllowlist(address solver, bool allowed) external onlyOwner {
        solverAllowlist[solver] = allowed;
        emit SolverAllowlistUpdated(solver, allowed);
    }

    function setEnforceSolverAllowlist(bool enabled) external onlyOwner {
        enforceSolverAllowlist = enabled;
        emit EnforceAllowlistUpdated(enabled);
    }
}
