import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../contracts/clients/CompXStakingClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: CompXStakingClient;
let admin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;

let stakingAccounts: any[] = [];

describe('CompXStaking ASA/Algo setup/admin functions - no staking', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    admin = testAccount.addr;

    appClient = new CompXStakingClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algorand.client.algod
    );
    await algokit.ensureFunded(
      {
        accountToFund: admin,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(14000),
      },
      algorand.client.algod,
    )

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 999_999_999_000n,
      decimals: 6,
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
    rewardAssetId = 0n;

    await appClient.create.createApplication({
      stakedAsset: stakedAssetId,
      rewardAsset: rewardAssetId,
      minLockUp: 10,
      contractDuration: 6034400n, // 71 Days in seconds
      startTimestamp: Math.floor(Date.now() / 1000),
      oracleAdmin: admin,
      adminAddress: admin,
    });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakeTokenPrice!.asBigInt()).toBe(0n);
    expect(globalState.rewardTokenPrice!.asBigInt()).toBe(0n);
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
    expect(globalState.minLockUp!.asBigInt()).toBe(10n);
    expect(globalState.contractDuration!.asBigInt()).toBe(6034400n);
    expect(globalState.rewardsAvailablePerTick!.asBigInt()).toBe(0n);
    expect(globalState.totalStakingWeight!.asBigInt()).toBe(0n);
    expect(algosdk.encodeAddress(globalState.oracleAdminAddress!.asByteArray())).toBe(admin);
  });

  test('updateParams', async () => {
    await appClient.updateParams({ minLockUp: 5, contractDuration: 6134400n });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.minLockUp!.asBigInt()).toBe(5n);
    expect(globalStateAfter.contractDuration!.asBigInt()).toBe(6134400n);
  });

  test('update params by non-admin', async () => {
    //create new account
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateParams(
        { minLockUp: 5, contractDuration: 6134400n },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()
  });

  test('opt app in', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    await algorand.send.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(0.3),
    });

    await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });

    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(algokit.algos(0.3).microAlgos);
  });

  test('add rewards non admin', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });

    const payTxn = await fixture.algorand.transactions.payment({
      sender: nonAdminAccount.addr,
      receiver: appAddress,
      amount: algokit.algos(1),
    });

    await expect(
      appClient.addRewardsAlgo(
        { payTxn, quantity: algokit.algos(1).microAlgos },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()

    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(0.3).microAlgos);
    expect((await appClient.getGlobalState()).totalRewards?.asBigInt()).toBe(0n);
  });

  test('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(13171),
    });

    await appClient.addRewardsAlgo({ payTxn, quantity: algokit.algos(13171).microAlgos });
    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(13171.3).microAlgos);
  });

  test('remove rewards non admin', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.removeRewards({ quantity: 0n }, { sender: nonAdminAccount }),
    ).rejects.toThrowError();

    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(13171.3).microAlgos);
  });
  test('remove rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    await appClient.removeRewards({ quantity: 0n }, { sendParams: { fee: algokit.algos(0.3) } });
    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(0.299).microAlgos);
  });

  test('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    let rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(0.299).microAlgos);

    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(13171),
    });

    await appClient.addRewardsAlgo({ payTxn, quantity: algokit.algos(13171).microAlgos });
    rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(13171.299).microAlgos);
  });

  test('set Prices', async () => {

    await appClient.setPrices({
      stakeTokenPrice: 1000000n,
      rewardTokenPrice: 150000n,
    });
    const stakedTokenPrice = (await appClient.getGlobalState()).stakeTokenPrice!.asBigInt();
    const rewardTokenPrice = (await appClient.getGlobalState()).rewardTokenPrice!.asBigInt();
    expect(stakedTokenPrice).toBe(1000000n);
    expect(rewardTokenPrice).toBe(150000n);
  });

  test('set Prices, non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.setPrices(
        {
          stakeTokenPrice: 1000000n,
          rewardTokenPrice: 150000n,
        },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError();
  });

  /*   test.skip('opt in to application ', async () => {
      await appClient.optIn.optInToApplication({});
      const localState = await appClient.getLocalState(admin);
      expect(localState.staked!.asBigInt()).toBe(0n);
      expect(localState.unlockTime!.asBigInt()).toBe(0n);
      expect(localState.stakeStartTime!.asBigInt()).toBe(0n);
    });
  
    test.skip('reward-rate-dev, 3 stakers, full rate', async () => {
      //Setup
      const PRECISION: uint64 = 10_000;
      const contractDuration: uint64 = 6134400;
      const i_StakeTokenPrice: uint64 = 1000000;
      const i_RewardTokenPrice: uint64 = 150000;
      const i_StakeDuration: uint64 = 6034400;
      const i_StakeAmount: uint64 = 1000000;
      const i_TotalRewards: uint64 = 13171000000;
      //set up total staking weight as 3 current stakers for full period
      const numStakers: uint64 = 3;
      const normalisedAmount: uint64 = Math.floor(((i_StakeAmount * i_StakeTokenPrice * PRECISION) / i_RewardTokenPrice) / PRECISION);
      console.log('normalisedAmount', normalisedAmount);
      //normalisedAmount = 1000000 * 1000000 * 1000000 / 150000 = 6666666
      const userStakingWeight: uint64 = Math.floor((normalisedAmount * i_StakeDuration));
      console.log('userStakingWeight', userStakingWeight);
      //userStakingWeight = 6666666 * 6034400 / 1000000 = 40200000
      const i_TotalStakingWeight: uint64 = Math.floor(userStakingWeight * numStakers);
      const i_TotalStakingWait_Jest = i_TotalStakingWeight + userStakingWeight;
  
      console.log('i_TotalStakingWeight', i_TotalStakingWeight);
      console.log('i_TotalStakingWait_Jest', i_TotalStakingWait_Jest);
      //i_TotalStakingWeight = 40200000 * 3 = 120600000
      const i_RewardsAvailablePerTick: uint64 = Math.floor(i_TotalRewards / contractDuration);
      console.log('i_RewardsAvailablePerTick', i_RewardsAvailablePerTick);
      const userShare: uint64 = Math.floor((userStakingWeight * PRECISION) / i_TotalStakingWait_Jest); // scale numerator
      console.log('userShare', userShare);
      const userSharePercentage: uint64 = Math.floor((userShare * 100) / PRECISION); // convert to percentage
      console.log('userSharePercentage', userSharePercentage);
      function gcd(a: uint64, b: uint64) {
        while (b !== 0) {
          let temp = b;
          b = a % b;
          a = temp;
        }
        return a;
      }
  
      //Convert decimal to fraction
      let numerator = (userSharePercentage * PRECISION);
      let denominator = PRECISION;
      const gcdValue = gcd(numerator, denominator);
      numerator = numerator / gcdValue;
      denominator = denominator / gcdValue;
      const expectedRewardRate: uint64 = (i_RewardsAvailablePerTick * numerator) / denominator;
  
      //const expectedRewardRate:uint64 = Math.floor((i_RewardsAvailablePerTick * PRECISION) / userSharePercentage); // needs better maths
      console.log('expectedRewardRate', expectedRewardRate);
  
      await appClient.getRewardRateDev({
        i_TotalStakingWeight,
        i_StakeTokenPrice,
        i_RewardTokenPrice,
        i_StakeDuration,
        i_StakeAmount,
        i_RewardsAvailablePerTick,
      });
      const localState = await appClient.getLocalState(admin);
      expect(localState.rewardRate!.asBigInt()).toBe(BigInt(Math.floor(expectedRewardRate)));
  
    }); */

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

