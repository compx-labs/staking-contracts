/* eslint-disable camelcase */
/* eslint-disable no-unused-vars */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk, { Account } from 'algosdk';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { PermissionlessInjectedRewardsPoolClient } from '../../contracts/clients/PermissionlessInjectedRewardsPoolClient';
import { deploy } from './deploy';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let pIRPClient: PermissionlessInjectedRewardsPoolClient;
let admin: Account;
let injector: Account;
let treasury: Account;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let xUSDAssetId: bigint;
// eslint-disable-next-line camelcase

async function getMBRFromAppClient() {
  const result = await pIRPClient.newGroup().getMbrForPoolCreation({ args: [], sender: admin.addr }).simulate();

  return result.returns![0];
}

describe('Permissionless Injected Reward Pool setup/admin functions - no staking', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { algorand } = fixture;
    admin = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    injector = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    treasury = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });

    pIRPClient = await deploy(admin, treasury, injector, admin);

    await algorand.account.ensureFundedFromEnvironment(admin.addr, algokit.algos(100));
    await algorand.account.ensureFundedFromEnvironment(injector.addr, algokit.algos(100));
    await algorand.account.ensureFundedFromEnvironment(treasury.addr, algokit.algos(100));

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Stake Token',
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);

    const rewardAssetOneCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Reward Token one',
    });
    rewardAssetOneId = BigInt((await rewardAssetOneCreate).confirmation.assetIndex!);

    const xUSDAssetCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'xUSD Token one',
    });
    xUSDAssetId = BigInt((await xUSDAssetCreate).confirmation.assetIndex!);

    await fixture.algorand.send.payment({
      sender: admin.addr,
      receiver: pIRPClient.appAddress,
      amount: algokit.algos(20),
    });

    await pIRPClient.send.initApplication({
      args: [stakedAssetId, rewardAssetOneId, xUSDAssetId, 200n],
      sender: admin.addr,
      assetReferences: [stakedAssetId, rewardAssetOneId, xUSDAssetId],
      extraFee: algokit.algos(0.2),
    });

    /*  await pIRPClient.send.initApplication(
      {
        stakedAsset: stakedAssetId,
        rewardAssetId: rewardAssetOneId,
        // eslint-disable-next-line camelcase
        xUSDFee: xUSD_FEE,
        xUSDAssetID: xUSDAssetId,
      },
      { sendParams: { fee: algokit.algos(0.2) } }
    ); */
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await pIRPClient.state.global.getAll();
    expect(globalState.stakedAssetId).toBe(stakedAssetId);
    expect(globalState.rewardAssetId).toBe(rewardAssetOneId);
    expect(globalState.contractVersion).toBe(2000n);
  });

  test('init storage', async () => {
    const { algorand } = fixture;

    const mbrPayment = await getMBRFromAppClient();
    consoleLogger.info('MBR for pool creation', mbrPayment?.mbrPayment);

    const payTxn = await algorand.createTransaction.payment({
      sender: admin.addr,
      receiver: pIRPClient.appAddress,
      amount: algokit.microAlgos(Number(mbrPayment?.mbrPayment)),
    });

    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [] })
      .gas({ note: '2', args: [] })
      .gas({ note: '3', args: [] })
      .initStorage({
        args: [payTxn],
        extraFee: algokit.algos(0.2),
        sender: admin.addr,
      })
      .send({ populateAppCallResources: true });

    const boxNames = await pIRPClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(1);
  });

  test('freeze rewards', async () => {
    pIRPClient.algorand.setSignerFromAccount(injector);
    await pIRPClient.send.setFreeze({
      args: [true],
      sender: injector.addr,
    });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const freezeState = globalStateAfter.freeze;
    consoleLogger.info('Freeze state', freezeState);
    // TODO
  });

  test('un-freeze rewards', async () => {
    await pIRPClient.send.setFreeze({ args: [false], sender: injector.addr });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const freezeState = globalStateAfter.freeze;
    /* const freezreValue = byteArrayToUint128(freezeState);
    expect(freezreValue).toBe(0n); */
  });

  test('freeze rewards by non-admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(pIRPClient.send.setFreeze({ args: [true], sender: nonAdminAccount.addr })).rejects.toThrow();
  });

  test('update injected asa rewards', async () => {
    await pIRPClient.send.updateInjectedAsaRewards({ args: [10n], sender: injector.addr });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const injectedASARewards = globalStateAfter.injectedAsaRewards;
    expect(injectedASARewards).toBe(10n);
  });
  test('update injected asa rewards as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      pIRPClient.send.updateInjectedAsaRewards({ args: [10n], sender: nonAdminAccount.addr })
    ).rejects.toThrow();
  });

  test('update injected xUSD rewards', async () => {
    await pIRPClient.send.updateInjectedxUsdRewards({ args: [10n], sender: injector.addr });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const injectedxUSDRewards = globalStateAfter.injectedxUsdRewards;
    expect(injectedxUSDRewards).toBe(10n);
  });
  test('update injected xUSD rewards as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      pIRPClient.send.updateInjectedxUsdRewards({ args: [10n], sender: nonAdminAccount.addr })
    ).rejects.toThrow();
  });

  test('update treasury address', async () => {
    const adminString = algosdk.encodeAddress(admin.addr.publicKey);
    await pIRPClient.send.updateTreasuryAddress({ args: [adminString], sender: injector.addr });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const { treasuryAddress } = globalStateAfter;
    // expect(algosdk.encodeAddress(treasuryAddress)).toBe(admin.addr);
  });

  test('update treasury address - non admin', async () => {
    const adminString = algosdk.encodeAddress(admin.addr.publicKey);
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      pIRPClient.send.updateTreasuryAddress({ args: [adminString], sender: nonAdminAccount.addr })
    ).rejects.toThrow();
  });

  test('update num stakers', async () => {
    await pIRPClient.send.updateNumStakers({ args: [10n], sender: injector.addr });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const { numStakers } = globalStateAfter;
    expect(numStakers).toBe(10n);
  });
  test('update num stakers non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(pIRPClient.send.updateNumStakers({ args: [10n], sender: nonAdminAccount.addr })).rejects.toThrow();
  });

  test('update injector address', async () => {
    const adminString = algosdk.encodeAddress(admin.addr.publicKey);
    await pIRPClient.send.updateInjectorAddress({ args: [adminString], sender: injector.addr });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const { injectorAddress } = globalStateAfter;
    expect(injectorAddress).toBe(adminString);
  });
  test('update injector address non admin', async () => {
    const adminString = algosdk.encodeAddress(admin.addr.publicKey);
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      pIRPClient.send.updateInjectorAddress({ args: [adminString], sender: nonAdminAccount.addr })
    ).rejects.toThrow();
  });

  test('activate pool', async () => {
    await pIRPClient.send.setPoolActive({ sender: admin.addr, args: [], extraFee: algokit.algos(0.01) });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const activeState = globalStateAfter.poolActive;
    expect(activeState).toBe(true);
  });

  test('set poolEnding true', async () => {
    await pIRPClient.send.setPoolEnding({ sender: admin.addr, args: [], extraFee: algokit.algos(0.01) });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    expect(globalStateAfter.poolEnding).toBe(true);
    expect(globalStateAfter.poolActive).toBe(false);
  });

  test('deleteApplication', async () => {
    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [] })
      .gas({ note: '2', args: [] })
      .gas({ note: '3', args: [] })
      .delete.deleteApplication({ args: [], sender: admin.addr, extraFee: algokit.microAlgo(2000) })
      .send({ populateAppCallResources: true });
  });
});
