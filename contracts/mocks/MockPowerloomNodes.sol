// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPowerloomNodes {
    uint256 public cooldownPeriod = 3600; // Example cooldown

    function snapshotterTokenClaimCooldown() external view returns (uint256) {
        return cooldownPeriod;
    }

    mapping(uint256 => address) public nodeIdToOwner;

    function setNodeOwner(uint256 nodeId, address owner) external {
        nodeIdToOwner[nodeId] = owner;
    }
}