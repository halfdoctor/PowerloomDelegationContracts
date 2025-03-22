# PowerloomDelegationContracts

This project contains smart contracts for managing delegation within the Powerloom network. It allows users to delegate their stake to node operators, enabling them to participate in the network and earn rewards.

## Project Structure

The project is structured as follows:

-   `contracts/`: Contains the Solidity smart contracts.
    -   `PowerloomDelegation.sol`: The main contract for managing delegation.
    -   `PowerloomDelegationold.sol`: An older version of the delegation contract.
    -   `mocks/`: Contains mock contracts for testing purposes.
        -   `MockPowerloomNodes.sol`: A mock implementation of the PowerloomNodes contract.
        -   `MockPowerloomState.sol`: A mock implementation of the PowerloomState contract.
-   `scripts/`: Contains deployment scripts.
    -   `deploy.js`: A script for deploying the `PowerloomDelegation` contract.
-   `test/`: Contains test files.
    -   `pdel2.js`: Contains tests for the `PowerloomDelegation` contract.
    -   `pdel2.deploydelegateburner.test.js`: Contains tests for deployment and initial setup.
    -   `pdel2.pausefeeacesseventswithdraw.test.js`: Contains tests for pausing, fee access, events, and withdrawal functionalities.
    -   `pdel.js`: Contains tests for the `PowerloomDelegationold` contract.
    -   `pdel.deploydelegateburner.test.js`: Contains tests for deployment and initial setup.
    -   `pdel.pausefeeacesseventswithdraw.test.js`: Contains tests for pausing, fee access, events, and withdrawal functionalities.
-   `hardhat.config.js`: Contains the Hardhat configuration, including network settings, compiler versions, and Etherscan API key.

## Purpose

The `PowerloomDelegation` contract allows users to delegate their stake to node operators in the Powerloom network. This enables them to participate in the network and earn rewards without having to run a node themselves. The contract manages the delegation process, including creating, renewing, and checking the expiry of delegations.

## Deployment

The `deploy.js` script can be used to deploy the `PowerloomDelegation` contract to a network. The script takes three arguments:

-   `POWERLOOM_STATE`: The address of the PowerloomState contract.
-   `POWERLOOM_NODES`: The address of the PowerloomNodes contract.
-   `INITIAL_BURNER_WALLET`: The address of the initial burner wallet.

These values are hardcoded in the script and should be updated to match the desired network.

To deploy the contract, run the following command:

```
npx hardhat run scripts/deploy.js --network <network>
```

Replace `<network>` with the name of the network to deploy to (e.g., `hardhat`, `power`, `power2`).

## Testing

The project includes a comprehensive set of tests for the `PowerloomDelegation` contract. The tests cover various functionalities, including delegation management, pausing, fee access, events, and withdrawal.

To run the tests, use the following command:

```
npx hardhat test
```

## Configuration

The `hardhat.config.js` file contains the Hardhat configuration. It defines the network settings, compiler versions, and Etherscan API key.

The `solidity` section specifies the Solidity compiler version and optimizer settings.

The `networks` section defines the network settings for different networks, including Hardhat, Powerloom, and Powerloom v2.

The `etherscan` section defines the Etherscan API key and custom chains for verifying the contract on Etherscan.
