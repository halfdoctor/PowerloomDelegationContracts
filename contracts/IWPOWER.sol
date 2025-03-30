// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.28;

/**
 * @title IWPOWER
 * @dev Interface for the Wrapped POWER (WPOWER) token
 */
interface IWPOWER {
    /**
     * @dev Emitted when native tokens are wrapped
     * @param src Address that initiated the deposit
     * @param dst Address that received the wrapped tokens
     * @param wad Amount of tokens wrapped
     */
    event Deposit(address indexed src, address indexed dst, uint256 wad);

    /**
     * @dev Emitted when wrapped tokens are unwrapped
     * @param src Address that initiated the withdrawal
     * @param dst Address that received the native tokens
     * @param wad Amount of tokens unwrapped
     */
    event Withdrawal(address indexed src, address indexed dst, uint256 wad);

    /**
     * @dev Deposits native tokens and mints wrapped tokens to the sender
     * @return Amount of wrapped tokens minted
     */
    function deposit() external payable returns (uint256);

    /**
     * @dev Deposits native tokens and mints wrapped tokens to the specified recipient
     * @param recipient Address to receive the wrapped tokens
     * @return Amount of wrapped tokens minted
     */
    function depositTo(address recipient) external payable returns (uint256);

    /**
     * @dev Unwraps tokens and sends native tokens to the sender
     * @param amount Amount of wrapped tokens to unwrap
     * @return Amount of native tokens sent
     */
    function withdraw(uint256 amount) external returns (uint256);

    /**
     * @dev Unwraps tokens and sends native tokens to the specified recipient
     * @param recipient Address to receive the native tokens
     * @param amount Amount of wrapped tokens to unwrap
     * @return Amount of native tokens sent
     */
    function withdrawTo(address recipient, uint256 amount) external returns (uint256);
}