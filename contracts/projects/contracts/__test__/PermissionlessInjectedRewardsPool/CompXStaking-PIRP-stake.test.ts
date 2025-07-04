/* eslint-disable no-var */
/* eslint-disable no-restricted-syntax */
/* eslint-disable vars-on-top */
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
import { getStakingAccount } from './utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });
const BYTE_LENGTH_STAKER = 56;

const PLATFORM_FEE_BPS = 200n; // 2% platform fee
const REWARD_ASA_REWARD_AMOUNT = 10_000_000n; // 10 ASA
let pIRPClient: PermissionlessInjectedRewardsPoolClient;
let admin: Account;
let injector: Account;
let treasury: Account;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let xUSDAssetId: bigint;
const NUM_STAKERS = 10n;
const NUM_REWARD_SENDERS = 2n;
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

    await fixture.algorand.send.assetOptIn({
      sender: treasury.addr,
      assetId: stakedAssetId,
    });
    await fixture.algorand.send.assetOptIn({
      sender: treasury.addr,
      assetId: rewardAssetOneId,
    });
    await fixture.algorand.send.assetOptIn({
      sender: treasury.addr,
      assetId: xUSDAssetId,
    });

    await pIRPClient.send.initApplication({
      args: [stakedAssetId, rewardAssetOneId, xUSDAssetId, PLATFORM_FEE_BPS],
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
      const stakerAccount = await fixture.context.generateAccount({
        initialFunds: algokit.algos(100),
        suppressLog: true,
      });
      stakers.push({
        account: stakerAccount,
        stakeAmount: STAKE_AMOUNT,
      });
      await fixture.algorand.account.ensureFundedFromEnvironment(stakerAccount.addr, algokit.algos(100));
      fixture.algorand.account.setSignerFromAccount(stakerAccount);
      await fixture.algorand.send.assetOptIn({
        sender: stakerAccount.addr,
        assetId: stakedAssetId,
        suppressLog: true,
      });
      await fixture.algorand.send.assetOptIn({
        sender: stakerAccount.addr,
        assetId: xUSDAssetId,
        suppressLog: true,
      });
      await fixture.algorand.send.assetOptIn({
        sender: stakerAccount.addr,
        assetId: rewardAssetOneId,
        suppressLog: true,
      });
      fixture.algorand.account.setSignerFromAccount(admin);
      await fixture.algorand.send.assetTransfer({
        sender: admin.addr,
        receiver: stakerAccount.addr,
        assetId: stakedAssetId,
        amount: STAKE_AMOUNT,
        suppressLog: true,
      });
    }
  });

  test('Init Reward Senders', async () => {
    for (let i = 0; i < NUM_REWARD_SENDERS; i++) {
      const rewardSenderAccount = await fixture.context.generateAccount({
        initialFunds: algokit.algos(100),
        suppressLog: true,
      });
      rewardSenders.push({
        account: rewardSenderAccount,
        rewardAmount: REWARD_AMOUNT,
      });
      await fixture.algorand.account.ensureFundedFromEnvironment(rewardSenderAccount.addr, algokit.algos(100));
      fixture.algorand.account.setSignerFromAccount(rewardSenderAccount);
      await fixture.algorand.send.assetOptIn({
        sender: rewardSenderAccount.addr,
        assetId: xUSDAssetId,
        suppressLog: true,
      });
      fixture.algorand.account.setSignerFromAccount(admin);
      await fixture.algorand.send.assetTransfer({
        sender: admin.addr,
        receiver: rewardSenderAccount.addr,
        assetId: xUSDAssetId,
        amount: REWARD_AMOUNT,
        suppressLog: true,
      });
    }
  }, 100000);

  test('stake', async () => {
    let index = 0;
    for (var staker of stakers) {
      fixture.algorand.account.setSignerFromAccount(staker.account);

      // Pre-checks
      const { balance: stakeTokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
        staker.account.addr,
        stakedAssetId
      );
      const { balance: appAlgoBalanceBefore } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);

      const axferTxn = await fixture.algorand.createTransaction.assetTransfer({
        sender: staker.account.addr,
        receiver: pIRPClient.appAddress,
        assetId: stakedAssetId,
        amount: staker.stakeAmount,
        maxFee: algokit.microAlgos(250_000n),
      });
      pIRPClient.algorand.setSignerFromAccount(staker.account);

      const txnResult = await pIRPClient
        .newGroup()
        .gas({ note: '1', args: [], maxFee: algokit.microAlgos(250_000n) })
        .gas({ note: '2', args: [], maxFee: algokit.microAlgos(250_000n) })
        .gas({ note: '3', args: [], maxFee: algokit.microAlgos(250_000n) })
        .stake({
          args: [axferTxn, staker.stakeAmount],
          sender: staker.account.addr,
          assetReferences: [stakedAssetId],
          maxFee: algokit.microAlgos(250_000n),
        })
        .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });

      // Check states to confirm staking.
      // check user balances against pre-check
      const { balance: stakeTokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
        staker.account.addr,
        stakedAssetId
      );
      const { balance: appAlgoBalanceAfter } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
      expect(appAlgoBalanceAfter.microAlgos).toBe(appAlgoBalanceBefore.microAlgos);
      expect(stakeTokenBalanceAfter).toBe(stakeTokenBalanceBefore - staker.stakeAmount);

      // Check box information to confirm staking.
      const stakerBox = await pIRPClient.appClient.getBoxValue('stakers');
      const stakerBoxInfo = getStakingAccount(stakerBox.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      expect(stakerBoxInfo.account).toBe(algosdk.encodeAddress(staker.account.addr.publicKey));
      expect(stakerBoxInfo.stake).toBe(staker.stakeAmount);
      expect(stakerBoxInfo.accruedASARewards).toBe(0n);
      expect(stakerBoxInfo.accruedxUSDRewards).toBe(0n);
      index += BYTE_LENGTH_STAKER;
    }
  });

  test('Send Rewards x1', async () => {
    const rewardSender = rewardSenders[0];
    fixture.algorand.account.setSignerFromAccount(rewardSender.account);
    // Pre-checks
    const { balance: xUSDTokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.account.addr,
      xUSDAssetId
    );
    const { balance: appAlgoBalanceBefore } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);

    const axferTxn = await fixture.algorand.createTransaction.assetTransfer({
      sender: rewardSender.account.addr,
      receiver: pIRPClient.appAddress,
      assetId: xUSDAssetId,
      amount: rewardSender.rewardAmount,
    });

    // Simulate call to get fees
    pIRPClient.algorand.setSignerFromAccount(rewardSender.account);

    const txnResult = await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '2', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '3', args: [], maxFee: algokit.microAlgos(250_000n) })
      .injectxUsd({
        args: [axferTxn, rewardSender.rewardAmount],
        sender: rewardSender.account.addr,
        assetReferences: [xUSDAssetId],
        maxFee: algokit.microAlgos(250_000n),
      })
      .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });

    // Check states to confirm rewards sent.
    // check user balances against pre-check
    const { balance: xUSDTokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.account.addr,
      xUSDAssetId
    );
    const { balance: appAlgoBalanceAfter } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
    expect(xUSDTokenBalanceAfter).toBe(xUSDTokenBalanceBefore - rewardSender.rewardAmount);
    expect(appAlgoBalanceAfter.microAlgos).toBe(appAlgoBalanceBefore.microAlgos);

    let index = 0;
    for (var staker of stakers) {
      const stakerBox = await pIRPClient.appClient.getBoxValue('stakers');
      const stakerBoxInfo = getStakingAccount(stakerBox.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      consoleLogger.info('Staker Box Info', stakerBoxInfo);
      expect(stakerBoxInfo.account).toBe(algosdk.encodeAddress(staker.account.addr.publicKey));
      expect(stakerBoxInfo.stake).toBe(STAKE_AMOUNT);
      expect(stakerBoxInfo.accruedASARewards).toBe(0n);
      expect(stakerBoxInfo.accruedxUSDRewards).toBe(REWARD_AMOUNT / NUM_STAKERS);
      index += BYTE_LENGTH_STAKER;
    }
  });

  test('Send Rewards x2', async () => {
    const rewardSender = rewardSenders[1];
    fixture.algorand.account.setSignerFromAccount(rewardSender.account);
    // Pre-checks
    const { balance: xUSDTokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.account.addr,
      xUSDAssetId
    );
    const { balance: appAlgoBalanceBefore } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);

    const axferTxn = await fixture.algorand.createTransaction.assetTransfer({
      sender: rewardSender.account.addr,
      receiver: pIRPClient.appAddress,
      assetId: xUSDAssetId,
      amount: rewardSender.rewardAmount,
    });

    pIRPClient.algorand.setSignerFromAccount(rewardSender.account);

    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '2', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '3', args: [], maxFee: algokit.microAlgos(250_000n) })
      .injectxUsd({
        args: [axferTxn, rewardSender.rewardAmount],
        sender: rewardSender.account.addr,
        assetReferences: [xUSDAssetId],
        maxFee: algokit.microAlgos(250_000n),
      })
      .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
    // Check states to confirm rewards sent.
    // check user balances against pre-check
    const { balance: xUSDTokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.account.addr,
      xUSDAssetId
    );
    const { balance: appAlgoBalanceAfter } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
    expect(appAlgoBalanceAfter.microAlgos).toBe(appAlgoBalanceBefore.microAlgos);
    expect(xUSDTokenBalanceAfter).toBe(xUSDTokenBalanceBefore - rewardSender.rewardAmount);

    // Check box data to confirm rewards sent.
    let index = 0;
    for (var staker of stakers) {
      const stakerBox = await pIRPClient.appClient.getBoxValue('stakers');
      const stakerBoxInfo = getStakingAccount(stakerBox.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      consoleLogger.info('Staker Box Info', stakerBoxInfo);
      expect(stakerBoxInfo.account).toBe(algosdk.encodeAddress(staker.account.addr.publicKey));
      expect(stakerBoxInfo.stake).toBe(STAKE_AMOUNT);
      expect(stakerBoxInfo.accruedASARewards).toBe(0n);
      expect(stakerBoxInfo.accruedxUSDRewards).toBe((REWARD_AMOUNT / NUM_STAKERS) * 2n);
      index += BYTE_LENGTH_STAKER;
    }
  });

  test('Send ASA rewards from admin', async () => {
    const rewardSender = admin;
    fixture.algorand.account.setSignerFromAccount(rewardSender);
    // Pre-checks
    const { balance: ASATokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.addr,
      rewardAssetOneId
    );
    const { balance: appAlgoBalanceBefore } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);

    const axferTxn = await fixture.algorand.createTransaction.assetTransfer({
      sender: rewardSender.addr,
      receiver: pIRPClient.appAddress,
      assetId: rewardAssetOneId,
      amount: REWARD_ASA_REWARD_AMOUNT,
    });

    pIRPClient.algorand.setSignerFromAccount(rewardSender);

    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '2', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '3', args: [], maxFee: algokit.microAlgos(250_000n) })
      .injectRewards({
        args: [axferTxn, REWARD_ASA_REWARD_AMOUNT, rewardAssetOneId],
        sender: rewardSender.addr,
        assetReferences: [rewardAssetOneId],
        maxFee: algokit.microAlgos(250_000n),
      })
      .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
    // Check states to confirm rewards sent.
    // check user balances against pre-check
    const { balance: ASATokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.addr,
      rewardAssetOneId
    );
    const { balance: appAlgoBalanceAfter } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
    expect(ASATokenBalanceAfter).toBe(ASATokenBalanceBefore - REWARD_ASA_REWARD_AMOUNT);
    expect(appAlgoBalanceAfter.microAlgos).toBe(appAlgoBalanceBefore.microAlgos);

    const platformFee = (REWARD_ASA_REWARD_AMOUNT * PLATFORM_FEE_BPS) / 10000n; // 2% platform fee
    const actualTotalReward = REWARD_ASA_REWARD_AMOUNT - platformFee;

    // confirm treasury platform fee received

    // Check box data to confirm rewards sent.
    let index = 0;
    for (var staker of stakers) {
      const stakerBox = await pIRPClient.appClient.getBoxValue('stakers');
      const stakerBoxInfo = getStakingAccount(stakerBox.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      consoleLogger.info('Staker Box Info', stakerBoxInfo);
      expect(stakerBoxInfo.account).toBe(algosdk.encodeAddress(staker.account.addr.publicKey));
      expect(stakerBoxInfo.stake).toBe(STAKE_AMOUNT);
      expect(stakerBoxInfo.accruedASARewards).toBe(actualTotalReward / NUM_STAKERS);
      index += BYTE_LENGTH_STAKER;
    }
  });

  test("Send rewards direect to application from Admin's account", async () => {
    const rewardSender = admin;
    fixture.algorand.account.setSignerFromAccount(rewardSender);

    // Pre-checks
    const { balance: ASATokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.addr,
      rewardAssetOneId
    );
    const { balance: algoBalanceBefore } = await fixture.algorand.account.getInformation(rewardSender.addr);

    await fixture.algorand.send.assetTransfer({
      sender: rewardSender.addr,
      receiver: pIRPClient.appAddress,
      assetId: rewardAssetOneId,
      amount: REWARD_ASA_REWARD_AMOUNT,
    });

    const { balance: ASATokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      rewardSender.addr,
      rewardAssetOneId
    );
    const { balance: algoBalanceAfter } = await fixture.algorand.account.getInformation(rewardSender.addr);
    expect(ASATokenBalanceAfter).toBe(ASATokenBalanceBefore - REWARD_ASA_REWARD_AMOUNT);
    expect(algoBalanceAfter.microAlgos).toBe(algoBalanceBefore.microAlgos - 1000n);
  });

  test('Staker 1 claim rewards', async () => {
    // This will cause the balances to accrue to users from the previously sent ASA rewards
    const staker = stakers[0];
    fixture.algorand.account.setSignerFromAccount(staker.account);

    // Pre-checks
    const { balance: ASATokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      rewardAssetOneId
    );
    const { balance: appAlgoBalanceBefore } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);

    pIRPClient.algorand.setSignerFromAccount(staker.account);
    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '2', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '3', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '4', args: [], maxFee: algokit.microAlgos(250_000n) })
      .claimRewards({
        args: [],
        sender: staker.account.addr,
        assetReferences: [rewardAssetOneId],
        maxFee: algokit.microAlgos(250_000n),
      })
      .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });

    const { balance: ASATokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      rewardAssetOneId
    );
    const platformFee = (REWARD_ASA_REWARD_AMOUNT * PLATFORM_FEE_BPS) / 10000n; // 2% platform fee
    const actualTotalReward = REWARD_ASA_REWARD_AMOUNT - platformFee;
    const { balance: appAlgoBalanceAfter } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
    expect(appAlgoBalanceAfter.microAlgos).toBe(appAlgoBalanceBefore.microAlgos);
    expect(ASATokenBalanceAfter).toBe(ASATokenBalanceBefore + (actualTotalReward / NUM_STAKERS) * 2n);

    // Check box data to confirm rewards claimed by staker 1 and not staker 2 but accrual has occured.
    let index = 0;
    for (var s of stakers) {
      const stakerBox = await pIRPClient.appClient.getBoxValue('stakers');
      const stakerBoxInfo = getStakingAccount(stakerBox.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      consoleLogger.info('Staker Box Info', stakerBoxInfo);
      expect(stakerBoxInfo.account).toBe(algosdk.encodeAddress(s.account.addr.publicKey));
      if (index === 0) {
        // staker 1
        expect(stakerBoxInfo.accruedASARewards).toBe(0n);
      } else {
        expect(stakerBoxInfo.accruedASARewards).toBe((actualTotalReward / NUM_STAKERS) * 2n);
      }
      index += BYTE_LENGTH_STAKER;
    }
  });

  test('staker 2 unstake', async () => {
    const staker = stakers[1];
    fixture.algorand.account.setSignerFromAccount(staker.account);

    // Pre-checks
    const { balance: stakeTokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      stakedAssetId
    );
    const { balance: appAlgoBalanceBefore } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
    const { balance: xUSDTokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      xUSDAssetId
    );
    const { balance: RewardTokenBalanceBefore } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      rewardAssetOneId
    );

    const unstakeQuanity = 0n; // unstake all

    pIRPClient.algorand.setSignerFromAccount(staker.account);

    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '2', args: [], maxFee: algokit.microAlgos(250_000n) })
      .gas({ note: '3', args: [], maxFee: algokit.microAlgos(250_000n) })
      .unstake({
        args: [unstakeQuanity],
        sender: staker.account.addr,
        assetReferences: [stakedAssetId, xUSDAssetId, rewardAssetOneId],
        maxFee: algokit.microAlgos(250_000n),
      })
      .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });

    // platform fee is not charged on unstake but need to confirm what it should be against their rewards
    const platformFee = (REWARD_ASA_REWARD_AMOUNT * PLATFORM_FEE_BPS) / 10000n; // 2% platform fee
    const actualTotalReward = REWARD_ASA_REWARD_AMOUNT - platformFee;

    // Check states to confirm unstaking.
    // check user balances against pre-check
    const { balance: stakeTokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      stakedAssetId
    );
    const { balance: appAlgoBalanceAfter } = await fixture.algorand.account.getInformation(pIRPClient.appAddress);
    const { balance: xUSDTokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      xUSDAssetId
    );
    const { balance: RewardTokenBalanceAfter } = await fixture.algorand.asset.getAccountInformation(
      staker.account.addr,
      rewardAssetOneId
    );
    expect(appAlgoBalanceAfter.microAlgos).toBe(appAlgoBalanceBefore.microAlgos);
    expect(stakeTokenBalanceAfter).toBe(stakeTokenBalanceBefore + STAKE_AMOUNT);
    expect(xUSDTokenBalanceAfter).toBe(xUSDTokenBalanceBefore + (REWARD_AMOUNT / NUM_STAKERS) * 2n);
    expect(RewardTokenBalanceAfter).toBe(RewardTokenBalanceBefore + (actualTotalReward / NUM_STAKERS) * 2n);
  });

  test.skip('deleteApplication', async () => {
    await pIRPClient
      .newGroup()
      .gas({ note: '1', args: [] })
      .gas({ note: '2', args: [] })
      .gas({ note: '3', args: [] })
      .delete.deleteApplication({ args: [], sender: admin.addr, extraFee: algokit.microAlgo(2000) })
      .send({ populateAppCallResources: true });
  });
});
