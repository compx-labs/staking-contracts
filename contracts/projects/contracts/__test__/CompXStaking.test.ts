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

describe('CompXStaking', () => {
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
    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 10n,
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
    const rewardAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 10n,
    });
    rewardAssetId = BigInt((await rewardAssetCreate).confirmation.assetIndex!);

    await appClient.create.createApplication({
      stakedAsset: stakedAssetId,
      rewardAsset: rewardAssetId,
      minLockUp: 1,
      oracleAppID: 159512493,
      contractDuration: 161000,
    });
  });

  /*  test('updateParams', async () => {
    await appClient.updateParams({ minLockUp: 5, maxLockUp: 100, oracleAppID: 159512493, contractDuration: 75 });
    const globalState = await appClient.getGlobalState();
    expect(globalState.minLockUp!.asBigInt()).toBe(5n);
    expect(globalState.maxLockUp!.asBigInt()).toBe(100n);
    expect(globalState.oracleAppID!.asBigInt()).toBe(159512493n);
    expect(globalState.contractDuration!.asBigInt()).toBe(75n);
  }); */

  test('opt app in', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const mbrTxn = await algorand.transactions.payment({
      sender: admin,
      receiver: appAddress,
      amount: algokit.algos(2),
      extraFee: algokit.algos(0.1),
    });
    await appClient.optInToAsset({ mbrTxn });
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
      amount: 1n,
      extraFee: algokit.algos(0.1),
    });
    await appClient.addRewards({ rewardTxn: axferTxn, quantity: 1n });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(1n);
  });

  test('opt in to application', async () => {
    await appClient.optIn.optInToApplication({});
    const localState = await appClient.getLocalState(admin);
    expect(localState.staked!.asBigInt()).toBe(0n);
    expect(localState.unlockTime!.asBigInt()).toBe(0n);
    expect(localState.stakeStartTime!.asBigInt()).toBe(0n);
  });

  test('stake tokens', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: admin,
      receiver: appAddress,
      assetId: stakedAssetId,
      amount: 1_000_000n,
      extraFee: algokit.algos(0.1),
    });
    await appClient.stake({ stakeTxn: axferTxn, quantity: 1, lockPeriod: 30 });

    const stakedAmount = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    expect(stakedAmount).toBe(1n);
    const localState = await appClient.getLocalState(admin);
    expect(localState.staked!.asBigInt()).toBe(1n);
  });

  test('unstake tokens', async () => {
    const { algorand } = fixture;
    const stakedAmountBefore = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    await appClient.unstake({});
    const stakedAmountAfter = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    expect(stakedAmountBefore).toBe(1n);
    expect(stakedAmountAfter).toBe(0n);
    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(admin, stakedAssetId);
    expect(stakedAssetBalance).toBe(10n);
  });
});
