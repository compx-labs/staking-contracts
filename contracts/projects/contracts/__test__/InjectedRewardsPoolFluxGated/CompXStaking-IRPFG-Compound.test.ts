import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolFluxGatedClient } from '../../contracts/clients/InjectedRewardsPoolFluxGatedClient';
import { Account } from 'algosdk';
import { getStakingAccount, StakingAccount } from '../utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { deploy, getFluxGateClient } from './deploy';
import { FluxGateClient } from './flux-gateClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolFluxGatedClient;
let fluxOracleAppId: bigint = 20241n;
let admin: Account;
let stakeAndRewardAssetId: bigint;
let ASAInjectionAmount = 10n * 10n ** 6n;
const BYTE_LENGTH_STAKER = 48;
const numStakers = 2;
let stakingAccounts: StakingAccount[] = [];

async function getMBRFromAppClient() {
  const result = await appClient
    .newGroup()
    .getMbrForPoolCreation({ args: [] })
    .simulate({ allowUnnamedResources: true });
  return result.returns![0];
}

describe('Injected Reward Pool - 50x stakers test', () => {
  beforeEach(fixture.beforeEach);

  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    const { generateAccount } = fixture.context;
    admin = await generateAccount({ initialFunds: algokit.microAlgo(6_000_000_000) });

    appClient = await deploy(admin);
    await algokit.ensureFunded(
      {
        accountToFund: admin,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(100),
      },
      algorand.client.algod
    );

    const stakeAndRewardToken = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Stake Token',
    });
    stakeAndRewardAssetId = BigInt((await stakeAndRewardToken).confirmation.assetIndex!);

    const initialBalanceTxn = await fixture.algorand.createTransaction.payment({
      sender: admin.addr,
      receiver: appClient.appAddress,
      amount: algokit.microAlgos(400_000),
    });

    await appClient.send.initApplication({
      args: [stakeAndRewardAssetId, stakeAndRewardAssetId, initialBalanceTxn, 1n, fluxOracleAppId],
    });
  });

  test('confirm global state on initialisation', async () => {
    appClient.algorand.setSignerFromAccount(admin);
    const globalState = await appClient.state.global.getAll();
    expect(globalState.stakedAssetId).toBe(stakeAndRewardAssetId);
    expect(globalState.rewardAssetId).toBe(stakeAndRewardAssetId);
    expect(globalState.lastRewardInjectionTime).toBe(0n);
  });

  test('init storage', async () => {
    appClient.algorand.setSignerFromAccount(admin);
    const mbr = await getMBRFromAppClient();
    const mbrTxn = await appClient.algorand.createTransaction.payment({
      sender: admin.addr,
      receiver: appClient.appAddress,
      amount: algokit.microAlgos(Number(mbr?.mbrPayment)),
    });

    await appClient
      .newGroup()
      .gas({ args: [], note: '1' })
      .gas({ args: [], note: '2' })
      .gas({ args: [], note: '3' })
      .initStorage({
        args: [mbrTxn],
      })
      .send();

    const boxNames = await appClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(1);
  });

  test('init stakers', async () => {
    const { algorand } = fixture;
    algorand.setSignerFromAccount(admin);
    for (var x = 0; x < numStakers; x++) {
      const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10), suppressLog: true });
      const staker = {
        account: account,
        stake: 10n * 10n ** 6n,
      };

      await algorand.send.assetTransfer({
        assetId: stakeAndRewardAssetId,
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
        suppressLog: true,
      });
      await algorand.send.assetTransfer({
        assetId: stakeAndRewardAssetId,
        amount: staker.stake,
        sender: admin.addr,
        receiver: staker.account.addr,
        suppressLog: true,
      });

      // Add to flux gate oracle
      const fluxGateClient = new FluxGateClient({
        algorand, // your AlgorandClient instance
        appId: BigInt(fluxOracleAppId), // the application ID
      });
      fluxGateClient.algorand.setSignerFromAccount(admin);

      await fluxGateClient.send.setUserTier({
        args: [staker.account.addr.toString(), 1n],
        sender: admin.addr,
        populateAppCallResources: true,
        suppressLog: true,
      });

      stakingAccounts.push(staker);
      //console.log('new staker created number ', x)
    }
  }, 600000);

  async function accrueRewards() {
    const globalStateAfter = await appClient.state.global.getAll();
    //console.log('injectedASARewards:', globalStateAfter.injectedAsaRewards);
    appClient.algorand.setSignerFromAccount(admin);
    const max_fee = 500_000;
    await appClient
      .newGroup()
      .gas({ args: [], note: '1', maxFee: AlgoAmount.MicroAlgos(max_fee) })
      .gas({ args: [], note: '2', maxFee: AlgoAmount.MicroAlgos(max_fee) })
      .gas({ args: [], note: '3', maxFee: AlgoAmount.MicroAlgos(max_fee) })
      .gas({ args: [], note: '4', maxFee: AlgoAmount.MicroAlgos(max_fee) })
      .accrueRewards({ args: [], maxFee: AlgoAmount.MicroAlgos(max_fee) })
      .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
    /*
    const stakerBox = await appClient.appClient.getBoxValue('stakers');
    const staker1 = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
    const staker2 = getStakingAccount(stakerBox.slice(BYTE_LENGTH_STAKER, BYTE_LENGTH_STAKER * 2), 8);
    console.log('staker1', staker1);
    console.log('staker2', staker2); */
  }

  test('staking', async () => {
    const { algorand } = fixture;

    for (var staker of stakingAccounts) {
      const stakerBalanceRequest = await algorand.client.algod
        .accountAssetInformation(staker.account!.addr, stakeAndRewardAssetId)
        .do();
      expect(stakerBalanceRequest.assetHolding?.amount).toBeGreaterThan(0n);
      appClient.algorand.setSignerFromAccount(staker.account!);
      algorand.setSignerFromAccount(staker.account!);
      const stakeTxn = await algorand.createTransaction.assetTransfer({
        assetId: stakeAndRewardAssetId,
        amount: staker.stake,
        sender: staker.account!.addr,
        receiver: appClient.appAddress,
        maxFee: AlgoAmount.MicroAlgos(250_000),
      });

      await appClient
        .newGroup()
        .gas({ args: [], note: '1', maxFee: AlgoAmount.MicroAlgos(250_000) })
        .gas({ args: [], note: '2', maxFee: AlgoAmount.MicroAlgos(250_000) })
        .gas({ args: [], note: '3', maxFee: AlgoAmount.MicroAlgos(250_000) })
        .stake({ args: [stakeTxn, staker.stake], sender: staker.account!.addr, maxFee: AlgoAmount.MicroAlgos(250_000) })
        .send({ populateAppCallResources: true, suppressLog: true, coverAppCallInnerTransactionFees: true });
    }
  }, 60000);

  test('inject rewards ASA ', async () => {
    const { algorand } = fixture;

    const axferTxn = await algorand.createTransaction.assetTransfer({
      sender: admin.addr,
      receiver: appClient.appAddress,
      assetId: stakeAndRewardAssetId,
      amount: ASAInjectionAmount,
    });

    appClient.algorand.setSignerFromAccount(admin);
    await appClient.send.injectRewards({
      args: [axferTxn, ASAInjectionAmount, stakeAndRewardAssetId],
      assetReferences: [stakeAndRewardAssetId],
      populateAppCallResources: true,
    });

    const globalStateAfter = await appClient.state.global.getAll();
    expect(globalStateAfter.injectedAsaRewards).toBe(ASAInjectionAmount);
    //console.log('injectedASARewards:', globalStateAfter.injectedAsaRewards);
  });

  test('accrueRewards', async () => {
    await accrueRewards();
  }, 60000);

  test('attempt to unstake more than staked', async () => {
    const staker = stakingAccounts[0];
    appClient.algorand.setSignerFromAccount(staker.account!);
    const max_fee = 250_000;
    await expect(
      appClient
        .newGroup()
        .gas({ args: [], note: '1', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .gas({ args: [], note: '2', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .gas({ args: [], note: '3', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .unstake({ args: [staker.stake + 1n], sender: staker.account!.addr, maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .send({ populateAppCallResources: true, suppressLog: true, coverAppCallInnerTransactionFees: true })
    ).rejects.toThrow();
  }, 60000);

  test('unstake all', async () => {
    let beforeIndex = 1;
    const stakeBefore: bigint[] = [];
    // Get stake before:
    for (var i = 0; i < numStakers; i++) {
      const stakerBoxBefore = await appClient.appClient.getBoxValue('stakers');
      const stakerInfoAfter = getStakingAccount(
        stakerBoxBefore.slice(beforeIndex - 1, BYTE_LENGTH_STAKER * beforeIndex),
        8
      );
      const stakeAfterUnstake = stakerInfoAfter.stake;
      stakeBefore.push(stakeAfterUnstake);
      //console.log(`staker ${i} after unstake:`, stakerInfoAfter);
      //console.log(`staker ${i} stakeAfterUnstake:`, stakeAfterUnstake);
      beforeIndex += BYTE_LENGTH_STAKER;
    }
    for (var i = 0; i < numStakers; i++) {
      const staker = stakingAccounts[i];
      appClient.algorand.setSignerFromAccount(staker.account!);

      const assetBalanceBeforeRequest = await appClient.algorand.client.algod
        .accountAssetInformation(staker.account!.addr, stakeAndRewardAssetId)
        .do();
      const assetBalanceBefore = assetBalanceBeforeRequest.assetHolding?.amount ?? 0n;
      const max_fee = 250_000;
      await appClient
        .newGroup()
        .gas({ args: [], note: '1', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .gas({ args: [], note: '2', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .gas({ args: [], note: '3', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .gas({ args: [], note: '4', maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .unstake({ args: [0], sender: staker.account!.addr, maxFee: AlgoAmount.MicroAlgos(max_fee) })
        .send({ populateAppCallResources: true, suppressLog: false, coverAppCallInnerTransactionFees: true });

      const assetBalanceAfterRequest = await appClient.algorand.client.algod
        .accountAssetInformation(staker.account!.addr, stakeAndRewardAssetId)
        .do();
      const assetBalanceAfter = assetBalanceAfterRequest.assetHolding?.amount ?? 0n;

      expect(assetBalanceAfter).toBeGreaterThan(assetBalanceBefore);
      expect(assetBalanceAfter).toBeGreaterThanOrEqual(assetBalanceBefore + stakeBefore[i]);
    }

    let afterIndex = 1;
    // Get stake after:
    for (var i = 0; i < numStakers; i++) {
      const stakerBoxAfter = await appClient.appClient.getBoxValue('stakers');
      const stakerInfoAfter = getStakingAccount(
        stakerBoxAfter.slice(afterIndex - 1, BYTE_LENGTH_STAKER * afterIndex),
        8
      );
      const stakeAfterUnstake = stakerInfoAfter.stake;
      expect(stakeAfterUnstake).toBe(0n);
      afterIndex += BYTE_LENGTH_STAKER;
    }
  }, 60000);

  test('deleteApplication', async () => {
    appClient.algorand.setSignerFromAccount(admin);
    await appClient
      .newGroup()
      .gas({ args: [], note: '1' })
      .gas({ args: [], note: '2' })
      .gas({ args: [], note: '3' })
      .gas({ args: [], note: '4' })
      .gas({ args: [], note: '5' })
      .delete.deleteApplication()
      .send();
  });
});
