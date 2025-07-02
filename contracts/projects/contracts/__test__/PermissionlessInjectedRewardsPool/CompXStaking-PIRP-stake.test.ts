/* eslint-disable no-plusplus */
/* eslint-disable no-await-in-loop */
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
const NUM_STAKERS = 2;
const NUM_REWARD_SENDERS = 2;
const STAKE_AMOUNT = 100_000_000n; // 100
const REWARD_AMOUNT = 1_000_000n; // 1 XUSD
// eslint-disable-next-line camelcase

interface Staker {
  account: Account;
  stakeAmount: bigint;
}
interface RewardSender {
  account: Account;
  rewardAmount: bigint;
}
const stakers: Staker[] = [];
const rewardSenders: RewardSender[] = [];

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

  test('activate pool', async () => {
    await pIRPClient.send.setPoolActive({ sender: admin.addr, args: [], extraFee: algokit.algos(0.01) });
    const globalStateAfter = await pIRPClient.state.global.getAll();
    const activeState = globalStateAfter.poolActive;
    expect(activeState).toBe(true);
  });

  test('Init Stakers', async () => {
    for (let i = 0; i < NUM_STAKERS; i++) {
      const stakerAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(100) });
      stakers.push({
        account: stakerAccount,
        stakeAmount: STAKE_AMOUNT,
      });
      await fixture.algorand.account.ensureFundedFromEnvironment(stakerAccount.addr, algokit.algos(100));
      fixture.algorand.account.setSignerFromAccount(stakerAccount);
      await fixture.algorand.send.assetOptIn({
        sender: stakerAccount.addr,
        assetId: stakedAssetId,
      });
      await fixture.algorand.send.assetOptIn({
        sender: stakerAccount.addr,
        assetId: xUSDAssetId,
      });
      fixture.algorand.account.setSignerFromAccount(admin);
      await fixture.algorand.send.assetTransfer({
        sender: admin.addr,
        receiver: stakerAccount.addr,
        assetId: stakedAssetId,
        amount: STAKE_AMOUNT,
      });
    }
  });

  test('Init Reward Senders', async () => {
    for (let i = 0; i < NUM_REWARD_SENDERS; i++) {
      const rewardSenderAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(100) });
      rewardSenders.push({
        account: rewardSenderAccount,
        rewardAmount: REWARD_AMOUNT,
      });
      await fixture.algorand.account.ensureFundedFromEnvironment(rewardSenderAccount.addr, algokit.algos(100));
      fixture.algorand.account.setSignerFromAccount(rewardSenderAccount);
      await fixture.algorand.send.assetOptIn({
        sender: rewardSenderAccount.addr,
        assetId: xUSDAssetId,
      });
      fixture.algorand.account.setSignerFromAccount(admin);
      await fixture.algorand.send.assetTransfer({
        sender: admin.addr,
        receiver: rewardSenderAccount.addr,
        assetId: xUSDAssetId,
        amount: REWARD_AMOUNT,
      });
    }
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
