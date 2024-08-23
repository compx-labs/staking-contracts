import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../../contracts/clients/CompXStakingClient';
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
        minSpendingBalance: algokit.algos(20),
      },
      algorand.client.algod,
    )

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'StakeToken',
    });
    const rewardAssetCreate = algorand.send.assetCreate({
      sender: admin,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'RewardToken',
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
    rewardAssetId = BigInt((await rewardAssetCreate).confirmation.assetIndex!);

    await appClient.create.createApplication({
      stakedAsset: stakedAssetId,
      rewardAsset: rewardAssetId,
      minLockUp: 10,
      contractDuration: 6034400n, // 71 Days in seconds
      startTimestamp: Math.floor(Date.now() / 1000),
      adminAddress: admin,
    });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
    expect(globalState.minLockUp!.asBigInt()).toBe(10n);
    expect(globalState.contractDuration!.asBigInt()).toBe(6034400n);
    expect(globalState.rewardsAvailablePerTick!.asBigInt()).toBe(0n);
    expect(globalState.totalStakingWeight!.asBigInt()).toBe(0n);
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
      amount: algokit.algos(10),
    });

    await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });
    await appClient.optInToAsset({ asset: rewardAssetId }, { sendParams: { fee: algokit.algos(0.1) } });


    const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(stakedAssetBalance).toBe(0n);
    expect(rewardAssetBalance).toBe(0n);
  });

  test('add rewards non admin', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });

    const rewardsInUnits = 100_000n * 10n**6n;
    const axferTxn = await fixture.algorand.transactions.assetTransfer({
        sender: admin,
        receiver: appAddress,
        assetId: rewardAssetId,
        amount: rewardsInUnits,
    });

    await expect(
      appClient.addRewards(
        { rewardTxn: axferTxn, quantity: rewardsInUnits },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()

    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(0n);
    expect((await appClient.getGlobalState()).totalRewards?.asBigInt()).toBe(0n);
  });

  test('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const rewardsInUnits = 100_000n * 10n**6n;
    const axferTxn = await fixture.algorand.transactions.assetTransfer({
        sender: admin,
        receiver: appAddress,
        assetId: rewardAssetId,
        amount: rewardsInUnits,
    });

    await appClient.addRewards({ rewardTxn: axferTxn, quantity: rewardsInUnits }, { sendParams: { fee: algokit.algos(0.1) } });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(rewardsInUnits);
    const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
    const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
    const contractDuration = (await appClient.getGlobalState()).contractDuration!.asBigInt();
    expect(totalRewards).toBe(BigInt(rewardsInUnits));
    expect(rewardsAvailablePerTick).toBe(BigInt(totalRewards / contractDuration));
    console.log('rewardsAvailablePerTick', rewardsAvailablePerTick); //
});

  test('remove rewards non admin', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.removeRewards({ quantity: 0n }, { sender: nonAdminAccount }),
    ).rejects.toThrowError();

    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(100_000n * 10n**6n);
  });
  test('remove rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    await appClient.removeRewards({ quantity: 0n }, { sendParams: { fee: algokit.algos(0.02) } });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(0n);
  });

  test('add rewards', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const rewardsInUnits = 100_000n * 10n**6n;
    const axferTxn = await fixture.algorand.transactions.assetTransfer({
        sender: admin,
        receiver: appAddress,
        assetId: rewardAssetId,
        amount: rewardsInUnits,
    });

    await appClient.addRewards({ rewardTxn: axferTxn, quantity: rewardsInUnits }, { sendParams: { fee: algokit.algos(0.1) } });
    const { balance: rewardAssetBalance } = await algorand.account.getAssetInformation(appAddress, rewardAssetId);
    expect(rewardAssetBalance).toBe(rewardsInUnits);
    const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
    const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
    const contractDuration = (await appClient.getGlobalState()).contractDuration!.asBigInt();
    expect(totalRewards).toBe(BigInt(rewardsInUnits));
    expect(rewardsAvailablePerTick).toBe(BigInt(totalRewards / contractDuration));
    console.log('rewardsAvailablePerTick', rewardsAvailablePerTick); //
});


  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

