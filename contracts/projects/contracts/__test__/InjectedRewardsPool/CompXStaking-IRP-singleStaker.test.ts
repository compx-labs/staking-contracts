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
interface StakingAccount {
  account?: TransactionSignerAccount;
  stake: bigint;
}
const STAKE_AMOUNT = 2_000_000_000n;

const stakingAccount: StakingAccount[] =
  [{
    stake: STAKE_AMOUNT,
  },
  {
    stake: STAKE_AMOUNT,
  },
  {
    stake: STAKE_AMOUNT,
  },
  {
    stake: STAKE_AMOUNT,
  },
  ]


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
      minStakePeriodForRewards: 0n,
    });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakeTokenPrice!.asBigInt()).toBe(0n);
    expect(globalState.rewardTokenPrice!.asBigInt()).toBe(0n);
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
    expect(globalState.totalStakingWeight!.asBigInt()).toBe(0n);
    expect(globalState.injectedRewards!.asBigInt()).toBe(0n);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(0n);
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
    for (var staker of stakingAccount) {
      staker.account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
      await appClient.optIn.optInToApplication({}, { sender: staker.account });
      await algorand.send.assetTransfer({
        assetId: stakedAssetId,
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
      });
      await algorand.send.assetTransfer({
        assetId: stakedAssetId,
        amount: STAKE_AMOUNT,
        sender: admin,
        receiver: staker.account.addr,
      });
    }
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
    const lastRewardInjectionAmount = (await appClient.getGlobalState()).injectedRewards!.asBigInt();
    expect(lastRewardInjectionAmount).toBe(BigInt(rewardsInUnits));
  });

  test('stake', async () => {
    const { algorand } = fixture;
    for (var staker of stakingAccount) {

      const { appAddress } = await appClient.appClient.getAppReference();

      const stakeTxn = await algorand.transactions.assetTransfer({
        assetId: stakedAssetId,
        amount: STAKE_AMOUNT,
        sender: staker.account!.addr,
        receiver: appAddress,
      });
      await appClient.stake({ quantity: STAKE_AMOUNT, stakeTxn }, { sender: staker.account, sendParams: { fee: algokit.algos(0.02) } });
      expect((await appClient.getLocalState(staker.account!.addr)).staked!.asBigInt()).toBe(STAKE_AMOUNT);
      const totalStakingWeight = (await appClient.getGlobalState()).totalStakingWeight!.asBigInt();
      expect((await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt()).toBe(0n);
      expect((await appClient.getLocalState(staker.account!.addr)).stakeStartTime!.asBigInt()).toBeGreaterThan(0n);
      expect((await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt()).toBeGreaterThan(0n);
    }
    for (var staker of stakingAccount) {
      await appClient.updateRewardRate({ userAddress: staker.account!.addr });
      expect((await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt()).toBeGreaterThan(0n);
    }

  });



  test('accrue rewards', async () => {
    for (var staker of stakingAccount) {
      await appClient.accrueRewards({ userAddress: staker.account!.addr }, { sender: staker.account, sendParams: { fee: algokit.algos(0.1) } });
      const userAccruedRewards = (await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt();
      const userRewardRate = (await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt();
      expect(userAccruedRewards).toBe(userRewardRate);
      const currentStake = (await appClient.getLocalState(staker.account!.addr)).staked!.asBigInt();
      expect(currentStake).toBe(STAKE_AMOUNT + userRewardRate);
    }
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
    const lastRewardInjectionAmount = (await appClient.getGlobalState()).injectedRewards!.asBigInt();
    expect(lastRewardInjectionAmount).toBe(BigInt(rewardsInUnits));
  });

  test('accrue rewards', async () => {
    for (var staker of stakingAccount) {
      await appClient.accrueRewards({ userAddress: staker.account!.addr }, { sender: staker.account, sendParams: { fee: algokit.algos(0.1) } });
      const userAccruedRewards = (await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt();
      const userRewardRate = (await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt();
      expect(userAccruedRewards).toBe(userRewardRate * 2n);
    }
    const remainingRewards = (await appClient.getGlobalState()).injectedRewards!.asBigInt();
    expect(remainingRewards).toBe(0n);
  });

  test('unstake', async () => {
    const { algorand } = fixture;
    for (var staker of stakingAccount) {
      console.log('stake Asset Id:', stakedAssetId)
      console.log('reward Asset Id:', rewardAssetId)
      const rewardAssetBalanceBefore = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetId)).balance;
      expect(rewardAssetBalanceBefore).toBe(0n);
      console.log('user reward balance before unstake', rewardAssetBalanceBefore);

      const accruedRewards = (await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt();
      const compoundedStake = (await appClient.getLocalState(staker.account!.addr)).staked!.asBigInt();
      console.log('user accrued compounded stake', compoundedStake);
      console.log('user accrued rewards unstake', accruedRewards);

      await appClient.unstake({}, { sender: staker.account, sendParams: { fee: algokit.algos(0.02) }, assets: [Number(stakedAssetId), Number(rewardAssetId)] });

      const rewardAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetId)).balance;
      const stakeAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      console.log('user stake balance after unstake', stakeAssetBalanceAfter);
      console.log('user reward balance after unstake', rewardAssetBalanceAfter);
      expect(rewardAssetBalanceAfter).toBe(compoundedStake);
    }
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

