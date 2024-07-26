import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../contracts/clients/CompXStakingClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: CompXStakingClient;
let admin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;

describe('CompXStaking ASA/Algo', () => {
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
    });
  });

  test.skip('updateParams', async () => {

    await appClient.updateParams({ minLockUp: 5, contractDuration: 6134400n });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.minLockUp!.asBigInt()).toBe(5n);
    expect(globalStateAfter.contractDuration!.asBigInt()).toBe(6134400n);
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
    const rewardAssetBalance = await (await algorand.account.getInformation(appAddress)).amount;
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(algokit.algos(0.3).microAlgos);
  });

  test.skip('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(13171),
    });

    await appClient.addRewardsAlgo({ payTxn, quantity: algokit.algos(13171).microAlgos });
    const rewardAssetBalance = await (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(13171.3).microAlgos);
  });


  test('opt in to application ', async () => {
    await appClient.optIn.optInToApplication({});
    const localState = await appClient.getLocalState(admin);
    expect(localState.staked!.asBigInt()).toBe(0n);
    expect(localState.unlockTime!.asBigInt()).toBe(0n);
    expect(localState.stakeStartTime!.asBigInt()).toBe(0n);
  });

  test.skip('set Prices', async () => {

    await appClient.setPrices({
      stakeTokenPrice: 1000000n,
      rewardTokenPrice: 150000n,
    });
    const stakedTokenPrice = (await appClient.getGlobalState()).stakeTokenPrice!.asBigInt();
    const rewardTokenPrice = (await appClient.getGlobalState()).rewardTokenPrice!.asBigInt();
    expect(stakedTokenPrice).toBe(1000000n);
    expect(rewardTokenPrice).toBe(150000n);
  });

  test('reward-rate-dev, 3 stakers, full rate', async () => {
    //Setup
    const PRECISION:uint64 = 10_000;
    const contractDuration:uint64 = 6134400;
    const i_StakeTokenPrice:uint64 = 1000000;
    const i_RewardTokenPrice:uint64 = 150000;
    const i_StakeDuration:uint64 = 6034400;
    const i_StakeAmount:uint64 = 1000000;
    const i_TotalRewards:uint64 = 13171000000;
    //set up total staking weight as 3 current stakers for full period
    const numStakers:uint64 = 3;
    const normalisedAmount:uint64 = Math.floor(((i_StakeAmount * i_StakeTokenPrice * PRECISION) / i_RewardTokenPrice) / PRECISION);
    console.log('normalisedAmount', normalisedAmount);
    //normalisedAmount = 1000000 * 1000000 * 1000000 / 150000 = 6666666
    const userStakingWeight:uint64 = Math.floor((normalisedAmount * i_StakeDuration));
    console.log('userStakingWeight', userStakingWeight);
    //userStakingWeight = 6666666 * 6034400 / 1000000 = 40200000
    const i_TotalStakingWeight:uint64 = Math.floor(userStakingWeight * numStakers);
    const i_TotalStakingWait_Jest = i_TotalStakingWeight + userStakingWeight;

    console.log('i_TotalStakingWeight', i_TotalStakingWeight);
    console.log('i_TotalStakingWait_Jest', i_TotalStakingWait_Jest);
    //i_TotalStakingWeight = 40200000 * 3 = 120600000
    const i_RewardsAvailablePerTick:uint64 = Math.floor(i_TotalRewards / contractDuration);
    console.log('i_RewardsAvailablePerTick', i_RewardsAvailablePerTick);
    const userShare:uint64 = Math.floor((userStakingWeight * PRECISION) / i_TotalStakingWait_Jest); // scale numerator
    console.log('userShare', userShare);
    const userSharePercentage:uint64 = Math.floor((userShare * 100) / PRECISION); // convert to percentage
    console.log('userSharePercentage', userSharePercentage);
    function gcd(a:uint64, b:uint64) {
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
    const expectedRewardRate:uint64 = (i_RewardsAvailablePerTick * numerator) / denominator; 

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

  });

  test.skip('removeRewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    await appClient.removeRewards({ quantity: 0n }, { sendParams: { fee: algokit.algos(0.3) } });
    const rewardAssetBalance = await (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(0.297).microAlgos);
  });

  test.skip('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});
