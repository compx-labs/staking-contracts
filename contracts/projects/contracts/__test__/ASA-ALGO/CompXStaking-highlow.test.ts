import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../../contracts/clients/CompXStakingClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128 } from '../utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: CompXStakingClient;
let admin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;
interface StakingAccount {
  account?: TransactionSignerAccount;
  stake: bigint;
  lockPeriod: bigint;
}
let stakingAccounts: StakingAccount[] = [
  {
    stake: 7_000_000_000n,
    lockPeriod: 2592000n,
  },
  {
    stake: 2_000_000_000n,
    lockPeriod: 2592000n,
  },
  {
    stake: 1_000_000n,
    lockPeriod: 2592000n,
  },
]


describe('CompXStaking ASA/Algo - with staking', () => {
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
        minSpendingBalance: algokit.algos(10010),
      },
      algorand.client.algod,
    )


    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 999_999_999_999_000n,
      decimals: 6,
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
    rewardAssetId = 0n;

    await appClient.create.createApplication({
      stakedAsset: stakedAssetId,
      rewardAsset: rewardAssetId,
      minLockUp: 10n, // 1 Day
      contractDuration: 2592000n, // 30 Days
      startTimestamp: BigInt(Math.floor(Date.now() / 1000)),
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
    expect(globalState.contractDuration!.asBigInt()).toBe(2592000n);
    expect(globalState.rewardsAvailablePerTick!.asBigInt()).toBe(0n);
    const tsw_ba = globalState.totalStakingWeight!.asByteArray();
    const tsw = byteArrayToUint128(tsw_ba);
    expect(tsw).toBe(0n);
    expect(algosdk.encodeAddress(globalState.oracleAdminAddress!.asByteArray())).toBe(admin);
  });

  test('opt app in', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    await algorand.send.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(1),
    });

    await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });

    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(algokit.algos(1).microAlgos);
  });

  test('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(10000),
    });

    await appClient.addRewardsAlgo({ payTxn, quantity: algokit.algos(10000).microAlgos });
    const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
    expect(rewardAssetBalance).toBe(algokit.algos(10001).microAlgos);
    const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
    const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
    const contractDuration = (await appClient.getGlobalState()).contractDuration!.asBigInt();
    expect(totalRewards).toBe(BigInt(algokit.algos(10000).microAlgos));
    console.log('rewardsAvailablePerTick', rewardsAvailablePerTick); //3858n
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

  test('creating accounts and opting in, prep for staking', async () => {
    const { algorand } = fixture;
    for (var staker of stakingAccounts) {
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
        amount: staker.stake,
        sender: admin,
        receiver: staker.account.addr,
      });
    }
  });

  async function accrueAll() {
    for (var staker of stakingAccounts) {

      await appClient.accrueRewards({ userAddress: staker.account!.addr }, { sender: staker.account, sendParams: { fee: algokit.algos(0.1) } });
      const userAccruedRewards = (await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt();
      const userRewardRate = (await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt();
      console.log('userAccruedRewards', userAccruedRewards);
      expect(userRewardRate).toBeGreaterThan(0n);
    }
  }



  test('stake', async () => {
    const { algorand } = fixture;
    const lockPeriod = 2588000n;
    for (var staker of stakingAccounts) {
      const stakedAssetBalanceBefore = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      const rewardAssetBalanceBefore = BigInt((await algorand.account.getInformation(staker.account!.addr)).amount);
      const { appAddress } = await appClient.appClient.getAppReference();

      const stakeTxn = await algorand.transactions.assetTransfer({
        assetId: stakedAssetId,
        amount: staker.stake,
        sender: staker.account!.addr,
        receiver: appAddress,
      });
      await appClient.stake({ lockPeriod: lockPeriod, quantity: staker.stake, stakeTxn }, { sender: staker.account, sendParams: { fee: algokit.algos(0.2) } });

      const stakedAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      const rewardAssetBalanceAfter = BigInt((await algorand.account.getInformation(staker.account!.addr)).amount);
      const rewardRate = (await appClient.getLocalState(staker.account!.addr)).rewardRate!.asBigInt();
      const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
      expect(stakedAssetBalanceBefore).toBe(staker.stake);
      expect(stakedAssetBalanceAfter).toBe(0n);
      expect(rewardAssetBalanceBefore).toBe(9998000n);
      expect(rewardAssetBalanceAfter).toBe(9797000n);
    }

  });

  async function waitForDuration(duration: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, duration);
    });
  }
  test('accrue reward 1', async () => {
    await waitForDuration(5000);
    accrueAll();
    await waitForDuration(5000);
    accrueAll();
  });




  test('unstake', async () => {
    const { algorand } = fixture;
    let totalPaidOut = 0n;
    for (var staker of stakingAccounts) {
      const rewardBalancePrior = BigInt((await algorand.account.getInformation(staker.account!.addr)).amount);
      const accruedRewards = (await appClient.getLocalState(staker.account!.addr)).accruedRewards!.asBigInt();
      console.log('rewardBalancePrior', rewardBalancePrior);
      console.log('accruedRewards', accruedRewards);
      await appClient.unstake({}, { sender: staker.account, sendParams: { fee: algokit.algos(0.002) } });
      //get asset balances
      const stakedAssetBalance = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      const rewardAssetBalance = BigInt((await algorand.account.getInformation(staker.account!.addr)).amount);
      console.log('stakedAssetBalance', stakedAssetBalance);
      console.log('rewardAssetBalance', rewardAssetBalance);
      totalPaidOut += (rewardAssetBalance - rewardBalancePrior);
    }
    const remainingRewards = (await appClient.getGlobalState()).remainingRewards!.asBigInt();
    const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
    console.log('remainingRewards', remainingRewards);
    console.log('totalRewards', totalRewards);
    console.log('rewards spent', totalRewards - remainingRewards);
    console.log('totalPaidOut', totalPaidOut);
  });

  test('delete app', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });

});