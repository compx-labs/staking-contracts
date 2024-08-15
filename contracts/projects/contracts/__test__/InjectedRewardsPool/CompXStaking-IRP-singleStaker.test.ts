import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolClient;
let admin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;
const ONE_DAY = 86400n;
const PRECISION = 10000n;
let stakingAccount: TransactionSignerAccount;

describe('Injected Reward Pool single staker', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    admin = testAccount.addr;

    appClient = new InjectedRewardsPoolClient(
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
        minSpendingBalance: algokit.algos(20),
      },
      algorand.client.algod,
    )

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Stake and Reward Token',
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
    rewardAssetId = stakedAssetId;

    await appClient.create.createApplication({
      stakedAsset: stakedAssetId,
      rewardAsset: stakedAssetId,
      oracleAdmin: admin,
      adminAddress: admin,
      minStakePeriodForRewards: 1n,
    });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakeTokenPrice!.asBigInt()).toBe(0n);
    expect(globalState.rewardTokenPrice!.asBigInt()).toBe(0n);
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
    expect(globalState.totalStakingWeight!.asBigInt()).toBe(0n);
    expect(globalState.lastRewardInjectionAmount!.asBigInt()).toBe(0n);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(1n);
    expect(algosdk.encodeAddress(globalState.oracleAdminAddress!.asByteArray())).toBe(admin);
  });

  test('opt app in', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    await algorand.send.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(10),
    });

    await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });
    await appClient.optInToAsset({ asset: rewardAssetId }, { sendParams: { fee: algokit.algos(0.1) } });

    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(0n);
  });

  test('creating accounts and opting in, prep for staking', async () => {
    const { algorand } = fixture;
    stakingAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await appClient.optIn.optInToApplication({}, { sender: stakingAccount });
    await algorand.send.assetTransfer({
      assetId: stakedAssetId,
      amount: 0n,
      sender: stakingAccount.addr,
      receiver: stakingAccount.addr,
    });
    await algorand.send.assetTransfer({
      assetId: stakedAssetId,
      amount: 50_000_000n,
      sender: admin,
      receiver: stakingAccount.addr,
    });
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

  test('stake', async () => {
    const { algorand } = fixture;
    const stakingAmount = 50_000_000n;
    const staker = stakingAccount;

    const { appAddress } = await appClient.appClient.getAppReference();

    const stakeTxn = await algorand.transactions.assetTransfer({
      assetId: stakedAssetId,
      amount: stakingAmount,
      sender: staker.addr,
      receiver: appAddress,
    });
    await appClient.stake({ quantity: stakingAmount, stakeTxn }, { sender: staker, sendParams: { fee: algokit.algos(0.02) } });
    expect((await appClient.getLocalState(staker.addr)).staked!.asBigInt()).toBe(stakingAmount);
    expect((await appClient.getGlobalState()).totalStakingWeight!.asBigInt()).toBe(33333n);
    expect((await appClient.getLocalState(staker.addr)).accruedRewards!.asBigInt()).toBe(0n);
    expect((await appClient.getLocalState(staker.addr)).stakeStartTime!.asBigInt()).toBeGreaterThan(0n);
  });

  test('inject rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const rewardsInUnits = 100n * 10n ** 6n;
    const axferTxn = await fixture.algorand.transactions.assetTransfer({
      sender: admin,
      receiver: appAddress,
      assetId: rewardAssetId,
      amount: rewardsInUnits,
    });
    const { balance: rewardAssetBalancePrior } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);

    await appClient.injectRewards({ rewardTxn: axferTxn, quantity: rewardsInUnits }, { sendParams: { fee: algokit.algos(0.1) } });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(rewardsInUnits + rewardAssetBalancePrior);
    const lastRewardInjectionAmount = (await appClient.getGlobalState()).lastRewardInjectionAmount!.asBigInt();
    expect(lastRewardInjectionAmount).toBe(BigInt(rewardsInUnits));
  });

  test('accrue rewards', async () => {
    const userStakeBefore = (await appClient.getLocalState(stakingAccount.addr)).staked!.asBigInt()
    const totalStakingWeightBefore = (await appClient.getGlobalState()).totalStakingWeight!.asBigInt();
    const userStakingWeight = (await appClient.getLocalState(stakingAccount.addr)).userStakingWeight!.asBigInt();
    console.log('userStakeBefore', userStakeBefore);
    console.log('totalStakingWeightBefore', totalStakingWeightBefore);
    console.log('userStakingWeight', userStakingWeight);
    await appClient.accrueRewards({ userAddress: stakingAccount.addr }, { sender: stakingAccount, sendParams: { fee: algokit.algos(0.01) } });
    const dev_userShare = (await appClient.getLocalState(stakingAccount.addr)).dev_userShare!.asBigInt();
    const userAccruedRewards = (await appClient.getLocalState(stakingAccount.addr)).accruedRewards!.asBigInt();
    const userStakeAfterRewards = (await appClient.getLocalState(stakingAccount.addr)).staked!.asBigInt();
    console.log('userAccruedRewards', userAccruedRewards);
    console.log('userStakeAfterRewards', userStakeAfterRewards);
    console.log('dev_userShare', dev_userShare);
  });

  test('unstake', async () => {
    const { algorand } = fixture;
    const staker = stakingAccount;
    const rewardAssetBalanceBefore = (await algorand.account.getAssetInformation(staker.addr, rewardAssetId)).balance;
    expect(rewardAssetBalanceBefore).toBe(0n);
    const accruedRewards = (await appClient.getLocalState(staker.addr)).accruedRewards!.asBigInt();
    appClient.unstake({}, { sender: staker, sendParams: { fee: algokit.algos(0.02) } });
    const rewardAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.addr, rewardAssetId)).balance;
    expect(rewardAssetBalanceAfter).toBe(rewardAssetBalanceBefore + accruedRewards);
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

