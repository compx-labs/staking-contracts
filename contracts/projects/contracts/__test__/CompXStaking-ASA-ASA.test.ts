import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../contracts/clients/CompXStakingClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: CompXStakingClient;
let admin: string;
let oracleAdmin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;

describe('CompXStaking ASA/ASA', () => {
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
    const oracleAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    oracleAdmin = oracleAdminAccount.addr;

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 999_999_999_000n,
      decimals: 6,
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
    const rewardAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 500_000_000_000n,
      decimals: 6,
    });

    rewardAssetId = BigInt((await rewardAssetCreate).confirmation.assetIndex!);

    await appClient.create.createApplication({
      stakedAsset: stakedAssetId,
      rewardAsset: rewardAssetId,
      minLockUp: 10,
      contractDuration: 6034400n, // 71 Days in seconds
      oracleAdminAddress: oracleAdminAccount.addr,
      startTimestamp: Math.floor(Date.now() / 1000),
    });
  });

   test('updateParams', async () => {
    await appClient.updateParams({ minLockUp: 5, oracleAdminAddress: oracleAdmin, contractDuration: 6134400n });
    const globalState = await appClient.getGlobalState();
    expect(globalState.minLockUp!.asBigInt()).toBe(5n);
    expect(globalState.oracleAdminAddress!.asString()).toBe(oracleAdmin);
    expect(globalState.contractDuration!.asBigInt()).toBe(6134400n);
  }); 

  test('opt app in', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    await algorand.send.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(0.5),
    });

    await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });
    await appClient.optInToAsset({ asset: rewardAssetId }, { sendParams: { fee: algokit.algos(0.1) } });
    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(0n);
  });

  test('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const axferTxn = await fixture.algorand.transactions.assetTransfer({
      sender: admin,
      receiver: appAddress,
      assetId: rewardAssetId,
      amount: 100_000_000_000n,
      extraFee: algokit.algos(0.1),
    });
    await appClient.addRewards({ rewardTxn: axferTxn, quantity: 100_000_000_000n });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(100_000_000_000n);
  });

  test('opt in to application ', async () => {
    await appClient.optIn.optInToApplication({});
    const localState = await appClient.getLocalState(admin);
    expect(localState.staked!.asBigInt()).toBe(0n);
    expect(localState.unlockTime!.asBigInt()).toBe(0n);
    expect(localState.stakeStartTime!.asBigInt()).toBe(0n);
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

  test('opt in, stake tokens ASA/ASA, unstake and check rewards', async () => {
    const { algorand } = fixture;

    const { appAddress } = await appClient.appClient.getAppReference();
    const stakerAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });

    await algorand.send.assetTransfer({
      sender: stakerAccount.addr,
      receiver: stakerAccount.addr,
      assetId: stakedAssetId,
      amount: 0n,
    });
    await algorand.send.assetTransfer({
      sender: stakerAccount.addr,
      receiver: stakerAccount.addr,
      assetId: rewardAssetId,
      amount: 0n,
    });

    await appClient.optIn.optInToApplication({}, { sender: stakerAccount });

    await algorand.send.assetTransfer({
      sender: admin,
      receiver: stakerAccount.addr,
      assetId: stakedAssetId,
      amount: 300_000_000n,
    });

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: stakerAccount.addr,
      receiver: appAddress,
      assetId: stakedAssetId,
      amount: 100_000_000n,
      extraFee: algokit.algos(0.1),
    });

    await appClient.stake(
      {
        stakeTxn: axferTxn,
        quantity: 100_000_000n,
        lockPeriod: 6048000n, // 71 Days in seconds
      },
      { sender: stakerAccount }
    );

    const stakedAmount = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    expect(stakedAmount).toBe(100_000_000n);
    const localState = await appClient.getLocalState(stakerAccount);
    expect(localState.staked!.asBigInt()).toBe(100_000_000n);
    console.log('user staking weight', localState.userStakingWeight!.asBigInt());
    console.log('total staking weight', (await appClient.getGlobalState()).totalStakingWeight!.asBigInt());
    console.log('remaining rewards', (await appClient.getGlobalState()).remainingRewards!.asBigInt());


    const stakedAmountBefore = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    await appClient.unstake({}, { sendParams: { fee: algokit.algos(0.3) }, sender: stakerAccount });
    console.log('userShare', (await appClient.getLocalState(stakerAccount)).userShare!.asBigInt());
    console.log('remaining rewards', (await appClient.getGlobalState()).remainingRewards!.asBigInt());
    console.log('rewards to payout', (await appClient.getGlobalState()).remainingRewards!.asBigInt());

    const stakedAmountAfter = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    expect(stakedAmountBefore).toBe(100_000_000n);
    expect(stakedAmountAfter).toBe(0n);

    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(
      stakerAccount.addr,
      rewardAssetId
    );
    console.log('rewardAssetBalance', rewardAssetBalance);

    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(
      stakerAccount.addr,
      stakedAssetId
    );
    expect(stakedAssetBalance).toBe(300_000_000n);
  });

  test('removeRewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    await appClient.removeRewards({ quantity: 0n }, { sendParams: { fee: algokit.algos(0.2) } });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(0n);
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.1) } });
  });
});
