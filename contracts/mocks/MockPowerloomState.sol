// MockPowerloomState.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPowerloomState {
    mapping(uint256 => address) public slotSnapshotterMapping;

    function setSnapshotter(uint256 slotId, address snapshotter) external {
        slotSnapshotterMapping[slotId] = snapshotter;
    }
}