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
      minLockUp: 5,
      contractDuration: 75,
      oracleAppID: 159512493,
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

  test('opt in, stake tokens, unstake and check rewards', async () => {
    const { algorand } = fixture;

    const { appAddress } = await appClient.appClient.getAppReference();
    const stakerAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });

    console.log('staker account', stakerAccount.addr);
    console.log('admin account', admin);
    console.log('app address', appAddress);

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
    await appClient.stake({ stakeTxn: axferTxn, quantity: 100_000_000n, lockPeriod: 5 }, { sender: stakerAccount });

    const stakedAmount = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    expect(stakedAmount).toBe(100_000_000n);
    let localState = await appClient.getLocalState(stakerAccount);
    expect(localState.staked!.asBigInt()).toBe(100_000_000n);

    // eslint-disable-next-line no-promise-executor-return
    await new Promise((r) => setTimeout(r, 6000));
    const { balance: preRewardBalance } = await algorand.account.getAssetInformation(stakerAccount.addr, rewardAssetId);
    console.log('preRewardBalance', preRewardBalance);

    await appClient.calculateRewards({}, { sender: stakerAccount });
    localState = await appClient.getLocalState(stakerAccount);
    console.log('localState.calculatedReward', localState.calculatedReward!.asBigInt());

    const stakedAmountBefore = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    await appClient.unstake({}, { sendParams: { fee: algokit.algos(0.2) }, sender: stakerAccount });

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

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({});
  });
});
