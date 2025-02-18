/* eslint-disable no-console */
/* eslint-disable no-plusplus */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-var */
/* eslint-disable vars-on-top */
/* eslint-disable no-restricted-syntax */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { InjectedRewardsPoolConsensusClient } from '../../contracts/clients/InjectedRewardsPoolConsensusClient';
import { StakingAccount } from './utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolConsensusClient;
let secondAppClient: InjectedRewardsPoolConsensusClient;
let admin: TransactionSignerAccount;
let lstAssetId: bigint;
let rewardAssetOneId: bigint;
const COMMISION = 8n;
const initialStakers = 5;
const algoPayment: AlgoAmount = algokit.algos(10);
let treasuryAccount: TransactionSignerAccount;
let migrationAdmin: TransactionSignerAccount;
const stakingAccounts: StakingAccount[] = [];
const rewardTokens: bigint[] = [];
export type MigrationParams = {
  lstBalance: bigint;
  totalStaked: bigint;
  circulatingLST: bigint;
  totalConsensusRewards: bigint;
  commisionAmount: bigint;
};

describe('Injected Reward Pool - 50x stakers test', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    admin = testAccount;

    appClient = new InjectedRewardsPoolConsensusClient(
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
        minSpendingBalance: algokit.algos(1000),
      },
      algorand.client.algod
    );

    const lstAssetCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'cALGO',
    });
    lstAssetId = BigInt((await lstAssetCreate).confirmation.assetIndex!);

    const rewardAssetOneCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Reward Token one',
    });
    rewardAssetOneId = BigInt((await rewardAssetOneCreate).confirmation.assetIndex!);
    rewardTokens.push(rewardAssetOneId);

    treasuryAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(0), suppressLog: true });
    migrationAdmin = await fixture.context.generateAccount({ initialFunds: algokit.algos(10), suppressLog: true });
    await algorand.send.assetTransfer(
      {
        assetId: lstAssetId,
        amount: 0n,
        sender: migrationAdmin.addr,
        receiver: migrationAdmin.addr,
      },
      { suppressLog: true }
    );

    await appClient.create.createApplication({
      adminAddress: admin.addr,
      treasuryAddress: treasuryAccount.addr,
      migrationAdmin: migrationAdmin.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(0.3),
    });

    await appClient.initApplication(
      {
        commision: COMMISION,
        lstTokenId: lstAssetId,
        payTxn,
      },
      { sendParams: { fee: algokit.algos(0.1) } }
    );
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(0n);
    expect(globalState.commisionPercentage!.asBigInt()).toBe(8n);
    expect(globalState.lstTokenId!.asBigInt()).toBe(lstAssetId);
  });

  test('init stakers', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('init stakers balanceBefore:', balanceBeforePay);
    for (var x = 0; x < initialStakers; x++) {
      const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(100), suppressLog: true });
      const staker = {
        account,
        stake: 10n * 10n ** 6n,
      };

      for (var i = 0; i < rewardTokens.length; i++) {
        await algorand.send.assetTransfer(
          {
            assetId: rewardTokens[i],
            amount: 0n,
            sender: staker.account.addr,
            receiver: staker.account.addr,
          },
          { suppressLog: true }
        );
      }
      await algorand.send.assetTransfer(
        {
          assetId: lstAssetId,
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        },
        { suppressLog: true }
      );

      stakingAccounts.push(staker);
    }
    const { amount: balanceAfter } = await algorand.account.getInformation(appAddress);
    console.log('init stakers balanceAfter:', balanceAfter);
  }, 600000);

  test('send lst balance to contract', async () => {
    const { algorand } = fixture;

    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceBeforelst } = await algorand.account.getInformation(appAddress);
    console.log('send lst balanceBeforelst:', balanceBeforelst);
    const axferTxn = await algorand.transactions.assetTransfer({
      sender: admin.addr,
      receiver: appAddress,
      assetId: lstAssetId,
      amount: 100_000_000_000n,
    });
    await appClient.addLst(
      { axferTxn, quantity: 100_000_000_000n },
      { sender: admin, sendParams: { fee: algokit.algos(0.1) }, assets: [Number(lstAssetId)] }
    );
    const lstBalance = (await algorand.account.getAssetInformation(appAddress, lstAssetId)).balance;
    expect(lstBalance).toBe(100_000_000_000n);
    const { amount: balanceAfterlst } = await algorand.account.getInformation(appAddress);
    console.log('send lst balanceAfterlst:', balanceAfterlst);
  });

  test('staking', async () => {
    let runningLSTTotal = 0n;
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceBeforeStake } = await algorand.account.getInformation(appAddress);
    console.log('staking balanceBeforeStake:', balanceBeforeStake);
    for (var staker of stakingAccounts) {
      const stakerBalance = (await algorand.account.getInformation(staker.account!.addr)).amount;
      expect(stakerBalance).toBeGreaterThan(0n);

      const payTxn = await algorand.transactions.payment({
        sender: staker.account!.addr,
        receiver: appAddress,
        amount: AlgoAmount.MicroAlgos(Number(staker.stake) + 1000),
      });
      let fees = AlgoAmount.MicroAlgos(240_000);
      const simulateResults = await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, payTxn }, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

      payTxn.group = undefined;
      fees = AlgoAmount.MicroAlgos(
        1000 + 1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
      );
      consoleLogger.info(`addStake fees:${fees.toString()}`);
      await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, payTxn }, { sender: staker.account, sendParams: { fee: fees } })

        .execute({ populateAppCallResources: true, suppressLog: true });

      const { amount: balanceAfterStake } = await algorand.account.getInformation(appAddress);
      console.log('staking balanceAfterStake:', balanceAfterStake);
      const lstBalance = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId)).balance;
      console.log('lstBalance:', lstBalance);
      runningLSTTotal += lstBalance;
      console.log('runningLSTTotal:', runningLSTTotal);
      expect(lstBalance).toBe(staker.stake);
    }
    console.log('final runningLSTTotal:', runningLSTTotal);
  }, 600000);

  test('send algo payment', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('balanceBeforePay:', balanceBeforePay);
    await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algoPayment,
    });
    const { amount: balanceAfterPAy } = await algorand.account.getInformation(appAddress);
    console.log('balanceAfterPAy:', balanceAfterPAy);
  });

  test('pickup rewards 0', async () => {
    // check initial state
    const gA = await appClient.getGlobalState();
    const totalConsensus1 = gA.totalConsensusRewards!.asBigInt();
    expect(totalConsensus1).toBe(0n);
    const commisionAmount = gA.commisionAmount!.asBigInt();
    expect(commisionAmount).toBe(0n);

    await appClient.pickupAlgoRewards({}, {});
    const gB = await appClient.getGlobalState();
    const totalConsensus2 = gB.totalConsensusRewards!.asBigInt();
    expect(totalConsensus2).toBeGreaterThan(0n);
    const commisionAmount2 = gB.commisionAmount!.asBigInt();
    console.log('PR0 commisionAmount:', commisionAmount2);
    console.log('PR0 consensus Rewards 2', totalConsensus2);
    expect(commisionAmount2).toBeGreaterThan(0n);

    await appClient.pickupAlgoRewards({}, {});
    const gC = await appClient.getGlobalState();
    const totalConsensus3 = gC.totalConsensusRewards!.asBigInt();
    expect(totalConsensus3).toBe(totalConsensus2);
    const commisionAmount3 = gC.commisionAmount!.asBigInt();
    expect(commisionAmount3).toBe(commisionAmount2);

    await appClient.pickupAlgoRewards({}, {});
    const gD = await appClient.getGlobalState();
    const totalConsensus4 = gD.totalConsensusRewards!.asBigInt();
    expect(totalConsensus4).toBe(totalConsensus3);
    const commisionAmount4 = gD.commisionAmount!.asBigInt();
    expect(commisionAmount4).toBe(commisionAmount3);
  });

  test('migrate contract', async () => {
    const { algorand } = fixture;

    secondAppClient = new InjectedRewardsPoolConsensusClient(
      {
        sender: admin,
        resolveBy: 'id',
        id: 0,
      },
      algorand.client.algod
    );
    await secondAppClient.create.createApplication({
      adminAddress: admin.addr,
      treasuryAddress: treasuryAccount.addr,
      migrationAdmin: migrationAdmin.addr,
    });
    const { appAddress } = await secondAppClient.appClient.getAppReference();

    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(0.3),
    });

    await secondAppClient.initApplication(
      {
        commision: COMMISION,
        lstTokenId: lstAssetId,
        payTxn,
      },
      { sendParams: { fee: algokit.algos(0.1) } }
    );

    const sp = await algorand.client.algod.getTransactionParams().do();

    const migrationMBRPayTxn = makePaymentTxnWithSuggestedParamsFromObject({
      amount: 1_000_000n,
      from: migrationAdmin.addr,
      to: appAddress,
      suggestedParams: sp,
    });

    const globalStateBeforeOldApp = await appClient.getGlobalState();
    const originalTotalStaked = globalStateBeforeOldApp.totalStaked!.asBigInt();
    const originalTotalConsensusRewards = globalStateBeforeOldApp.totalConsensusRewards!.asBigInt();
    const originalCommisionAmount = globalStateBeforeOldApp.commisionAmount!.asBigInt();
    const originalCirculatingLST = globalStateBeforeOldApp.circulatingLST!.asBigInt();
    const originalLSTBalance = globalStateBeforeOldApp.lstBalance!.asBigInt();
    const minimumBalance = globalStateBeforeOldApp.minimumBalance!.asBigInt();

    const oldAppAddress = await appClient.appClient.getAppReference();
    const { amount: oldAppBalanceBeforeMigration } = await algorand.account.getInformation(oldAppAddress.appAddress);

    const { amount: adminBalanceBeforeMigration } = await algorand.account.getInformation(migrationAdmin.addr);
    const { balance: adminLSTBalanceBeforeMigration } = await algorand.account.getAssetInformation(
      migrationAdmin.addr,
      lstAssetId
    );

    await appClient.updateAdminAddress(
      { adminAddress: migrationAdmin.addr },
      { sendParams: { fee: algokit.algos(0.1) }, sender: admin }
    );

    const migrationResponse = await appClient.migrateContract(
      { mbrTxn: migrationMBRPayTxn },
      { sendParams: { fee: algokit.algos(0.1) }, sender: migrationAdmin }
    );
    const { amount: adminBalanceAfterMigration } = await algorand.account.getInformation(migrationAdmin.addr);
    const { balance: adminLSTBalanceAfterMigration } = await algorand.account.getAssetInformation(
      migrationAdmin.addr,
      lstAssetId
    );
    const fees = 1_001_000n + BigInt(Number(algokit.algos(0.1)));

    expect(BigInt(adminBalanceAfterMigration)).toBe(
      BigInt(adminBalanceBeforeMigration) + (BigInt(oldAppBalanceBeforeMigration) - BigInt(minimumBalance) - fees)
    );
    expect(BigInt(adminLSTBalanceAfterMigration)).toBe(BigInt(adminLSTBalanceBeforeMigration) + originalLSTBalance);

    const migrationParams: MigrationParams = {
      lstBalance: migrationResponse.return![0],
      totalStaked: migrationResponse.return![1],
      circulatingLST: migrationResponse.return![2],
      totalConsensusRewards: migrationResponse.return![3],
      commisionAmount: migrationResponse.return![4],
    };
    console.log('migrationParams:', migrationParams);

    const algoTransfer = await algorand.transactions.payment({
      sender: migrationAdmin.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(
        Number(migrationParams.totalStaked) +
          Number(migrationParams.totalConsensusRewards) +
          Number(migrationParams.commisionAmount)
      ),
    });
    const lstTransfer = await algorand.transactions.assetTransfer({
      sender: migrationAdmin.addr,
      receiver: appAddress,
      assetId: lstAssetId,
      amount: migrationParams.lstBalance,
    });

    await secondAppClient.acceptMigration(
      {
        algoTransfer,
        lstTransfer,
        circulatingLST: migrationParams.circulatingLST,
        commisionAmount: migrationParams.commisionAmount,
        totalConsensusRewards: migrationParams.totalConsensusRewards,
        lstBalance: migrationParams.lstBalance,
        totalStaked: migrationParams.totalStaked,
      },
      { sendParams: { fee: algokit.algos(0.1) }, sender: migrationAdmin }
    );

    const globalStateAfterMigration = await secondAppClient.getGlobalState();
    expect(globalStateAfterMigration.totalStaked!.asBigInt()).toBe(originalTotalStaked);
    expect(globalStateAfterMigration.totalConsensusRewards!.asBigInt()).toBe(originalTotalConsensusRewards);
    expect(globalStateAfterMigration.commisionAmount!.asBigInt()).toBe(originalCommisionAmount);
    expect(globalStateAfterMigration.circulatingLST!.asBigInt()).toBe(originalCirculatingLST);
    expect(globalStateAfterMigration.lstBalance!.asBigInt()).toBe(originalLSTBalance);
  });

  test('pay commision out', async () => {
    const { appAddress } = await secondAppClient.appClient.getAppReference();
    const { amount: balanceBeforeCommision } = await fixture.algorand.account.getInformation(treasuryAccount.addr);
    const globalState = await secondAppClient.getGlobalState();
    const commisionAmount = globalState.commisionAmount!.asBigInt();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(1000),
    });
    await secondAppClient.payCommision({ payTxn }, { sendParams: { fee: algokit.microAlgos(1000) } });
    const { amount: balanceAfterCommision } = await fixture.algorand.account.getInformation(treasuryAccount.addr);
    expect(balanceAfterCommision).toBe(balanceBeforeCommision + Number(commisionAmount));
    const globalStateAfter = await secondAppClient.getGlobalState();
    const paidCommision = globalStateAfter.paidCommision!.asBigInt();
    expect(paidCommision).toBe(commisionAmount);
  });

  test('add new staker', async () => {
    const { algorand } = fixture;
    const { appAddress } = await secondAppClient.appClient.getAppReference();
    const { amount: balanceBeforeStake } = await algorand.account.getInformation(appAddress);
    console.log('staking balanceBeforeStake2:', balanceBeforeStake);
    const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(100), suppressLog: true });
    const staker = {
      account,
      stake: 10n * 10n ** 6n,
    };

    for (var i = 0; i < rewardTokens.length; i++) {
      await algorand.send.assetTransfer(
        {
          assetId: rewardTokens[i],
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        },
        { suppressLog: true }
      );
    }
    await algorand.send.assetTransfer(
      {
        assetId: lstAssetId,
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
      },
      { suppressLog: true }
    );

    stakingAccounts.push(staker);

    const payTxn = await algorand.transactions.payment({
      sender: staker.account!.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(Number(staker.stake) + 1000),
    });
    const globalState = await secondAppClient.getGlobalState();
    const totalStaked = globalState.totalStaked!.asBigInt();
    const totalConsensusRewards = globalState.totalConsensusRewards!.asBigInt();
    const circulatingLST = globalState.circulatingLST!.asBigInt();
    const nodeAlgo = totalStaked + totalConsensusRewards;

    expect(circulatingLST).toBeGreaterThan(0n);

    let fees = AlgoAmount.MicroAlgos(240_000);
    const simulateResults = await secondAppClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn }, { sender: staker.account, sendParams: { fee: fees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

    payTxn.group = undefined;
    fees = AlgoAmount.MicroAlgos(
      1000 + 1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
    );
    consoleLogger.info(`addStake fees:${fees.toString()}`);
    await secondAppClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn }, { sender: staker.account, sendParams: { fee: fees } })

      .execute({ populateAppCallResources: true, suppressLog: true });

    const { amount: balanceAfterStake } = await algorand.account.getInformation(appAddress);
    console.log('staking balanceAfterStake2:', balanceAfterStake);
    const lstBalance = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId)).balance;
    console.log('lstBalance:', lstBalance);

    const lstRatio = (circulatingLST * 10000n) / nodeAlgo;
    console.log('circulatingLST:', circulatingLST);
    console.log('nodeAlgo:', nodeAlgo);
    console.log('lstRatio:', lstRatio);
    const lstDue = (lstRatio * staker.stake) / 10000n;
    console.log('lstDue:', lstDue);
    expect(lstBalance).toBe(lstDue);
  });

  test('add more stake as staker[0] ', async () => {
    const staker = stakingAccounts[0];
    const { algorand } = fixture;
    const { appAddress } = await secondAppClient.appClient.getAppReference();

    const lstBalanceBeforeStake = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId))
      .balance;

    const payTxn = await algorand.transactions.payment({
      sender: staker.account!.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(Number(staker.stake) + 1000),
    });
    let fees = AlgoAmount.MicroAlgos(240_000);
    const simulateResults = await secondAppClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn }, { sender: staker.account, sendParams: { fee: fees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

    payTxn.group = undefined;
    fees = AlgoAmount.MicroAlgos(
      1000 + 1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
    );
    consoleLogger.info(`addStake fees:${fees.toString()}`);
    await secondAppClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn }, { sender: staker.account, sendParams: { fee: fees } })

      .execute({ populateAppCallResources: true, suppressLog: true });
    const globalState = await secondAppClient.getGlobalState();
    const totalStaked = globalState.totalStaked!.asBigInt();
    const totalConsensusRewards = globalState.totalConsensusRewards!.asBigInt();
    const circulatingLST = globalState.circulatingLST!.asBigInt();
    const nodeAlgo = totalStaked + totalConsensusRewards;
    const lstRatio = (circulatingLST * 10000n) / nodeAlgo;

    console.log(' final stake circulatingLST:', circulatingLST);
    console.log('nodeAlgo:', nodeAlgo);
    console.log('lstRatio:', lstRatio);
    const newLSTDue = (lstRatio * staker.stake) / 10000n;

    const { balance: lstBalanceafterStake } = await algorand.account.getAssetInformation(
      staker.account!.addr,
      lstAssetId
    );
    console.log('lstBalanceafterStake:', lstBalanceafterStake);
    expect(lstBalanceafterStake).toBe(lstBalanceBeforeStake + newLSTDue);
    stakingAccounts[0].stake = staker.stake * 2n;
  });

  test('send algo payment', async () => {
    const { algorand } = fixture;
    const { appAddress } = await secondAppClient.appClient.getAppReference();

    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('balanceBeforePay:', balanceBeforePay);
    await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algoPayment,
    });
    const { amount: balanceAfterPAy } = await algorand.account.getInformation(appAddress);
    console.log('balanceAfterPAy:', balanceAfterPAy);
  });

  test('pickup rewards 1', async () => {
    // check initial state
    const expectedInitialConsensusRewards = (BigInt(algoPayment.microAlgos) / 100n) * 92n;
    const expectedInitialCommisionAmount = (BigInt(algoPayment.microAlgos) / 100n) * 8n;
    const gA = await secondAppClient.getGlobalState();
    const totalConsensus1 = gA.totalConsensusRewards!.asBigInt();
    expect(totalConsensus1).toBe(expectedInitialConsensusRewards);
    const commisionAmount = gA.commisionAmount!.asBigInt();
    console.log('PR1 commisionAmount:', commisionAmount);
    expect(commisionAmount).toBe(0n);
    const paidCommision = gA.paidCommision!.asBigInt();
    console.log('PR1 paidCommision:', paidCommision);
    expect(paidCommision).toBe(expectedInitialCommisionAmount);

    const appAddress = await secondAppClient.appClient.getAppReference();
    const { amount: appBalance } = await fixture.algorand.account.getInformation(appAddress.appAddress);
    const minimumBalance = gA.minimumBalance!.asBigInt();
    const totalConsensusRewards = gA.totalConsensusRewards!.asBigInt();
    const totalStaked = gA.totalStaked!.asBigInt();

    console.log('PR1 appBalance', appBalance);

    console.log('PR1 params:', {
      appBalance,
      minimumBalance,
      totalConsensusRewards,
      totalStaked,
      commisionAmount,
      paidCommision,
    });
    const expectedBalance = BigInt(appBalance) - minimumBalance - totalConsensusRewards - totalStaked - commisionAmount;
    console.log('PR1 expectedBalance:', expectedBalance);

    await secondAppClient.pickupAlgoRewards({}, {});

    const gB = await secondAppClient.getGlobalState();
    const newCommision = gB.commisionAmount!.asBigInt();
    console.log('PR1 newCommision:', newCommision);
    const totalConsensus2 = gB.totalConsensusRewards!.asBigInt();
    expect(totalConsensus2).toBeGreaterThan(expectedInitialConsensusRewards * 2n);
    const commisionAmount2 = gB.commisionAmount!.asBigInt();
    expect(commisionAmount2).toBeGreaterThan(expectedInitialCommisionAmount);

    const appAddress2 = await secondAppClient.appClient.getAppReference();
    const { amount: appBalance2 } = await fixture.algorand.account.getInformation(appAddress2.appAddress);
    const totalConsensusRewards2 = gB.totalConsensusRewards!.asBigInt();

    console.log('PR1 params 2:', {
      appBalance2,
      minimumBalance,
      totalConsensusRewards2,
      totalStaked,
      commisionAmount2,
      paidCommision,
    });
    const expectedBalance2 =
      BigInt(appBalance2) - minimumBalance - totalConsensusRewards2 - totalStaked - commisionAmount2;
    console.log('PR1 expectedBalance2:', expectedBalance2);

    await secondAppClient.pickupAlgoRewards({}, {});
    const gC = await secondAppClient.getGlobalState();
    const totalConsensus3 = gC.totalConsensusRewards!.asBigInt();
    expect(totalConsensus3).toBe(totalConsensus2);
    const commisionAmount3 = gC.commisionAmount!.asBigInt();
    expect(commisionAmount3).toBe(commisionAmount2);

    await secondAppClient.pickupAlgoRewards({}, {});
    const gD = await secondAppClient.getGlobalState();
    const totalConsensus4 = gD.totalConsensusRewards!.asBigInt();
    expect(totalConsensus4).toBe(totalConsensus3);
    const commisionAmount4 = gD.commisionAmount!.asBigInt();
    expect(commisionAmount4).toBe(commisionAmount3);
  });

  test('pay commision out', async () => {
    const { appAddress } = await secondAppClient.appClient.getAppReference();
    const { amount: balanceBeforeCommision } = await fixture.algorand.account.getInformation(treasuryAccount.addr);
    const globalState = await secondAppClient.getGlobalState();
    const commisionAmount = globalState.commisionAmount!.asBigInt();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(1000),
    });
    await secondAppClient.payCommision({ payTxn }, { sendParams: { fee: algokit.microAlgos(1000) } });
    const { amount: balanceAfterCommision } = await fixture.algorand.account.getInformation(treasuryAccount.addr);
    expect(balanceAfterCommision).toBe(balanceBeforeCommision + Number(commisionAmount));
    const globalStateAfter = await secondAppClient.getGlobalState();
    const paidCommision = globalStateAfter.paidCommision!.asBigInt();
    expect(paidCommision).toBe(commisionAmount * 2n - 80000n);
  });

  test('send algo payment', async () => {
    const { algorand } = fixture;
    const { appAddress } = await secondAppClient.appClient.getAppReference();

    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('balanceBeforePay:', balanceBeforePay);
    await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algoPayment,
    });
    const { amount: balanceAfterPAy } = await algorand.account.getInformation(appAddress);
    console.log('balanceAfterPAy:', balanceAfterPAy);
  });

  test('pickup rewards 2', async () => {
    // check initial state
    const expectedInitialConsensusRewards = (BigInt(algoPayment.microAlgos) / 100n) * 92n;
    const expectedInitialCommisionAmount = (BigInt(algoPayment.microAlgos) / 100n) * 8n;
    const gA = await secondAppClient.getGlobalState();
    const totalConsensus1 = gA.totalConsensusRewards!.asBigInt();
    expect(totalConsensus1).toBe(expectedInitialConsensusRewards * 2n + 920000n);
    const commisionAmount = gA.commisionAmount!.asBigInt();
    expect(commisionAmount).toBe(0n);
    const paidCommision = gA.paidCommision!.asBigInt();
    expect(paidCommision).toBe(expectedInitialCommisionAmount * 2n + 80000n);

    // run pickup rewards
    await secondAppClient.pickupAlgoRewards({}, {});
    const gB = await secondAppClient.getGlobalState();
    const totalConsensus2 = gB.totalConsensusRewards!.asBigInt();
    expect(totalConsensus2).toBe(expectedInitialConsensusRewards * 3n + 920000n);
    const commisionAmount2 = gB.commisionAmount!.asBigInt();
    expect(commisionAmount2).toBe(expectedInitialCommisionAmount);

    await secondAppClient.pickupAlgoRewards({}, {});
    const gC = await secondAppClient.getGlobalState();
    const totalConsensus3 = gC.totalConsensusRewards!.asBigInt();
    expect(totalConsensus3).toBe(totalConsensus2);
    const commisionAmount3 = gC.commisionAmount!.asBigInt();
    expect(commisionAmount3).toBe(commisionAmount2);

    await secondAppClient.pickupAlgoRewards({}, {});
    const gD = await secondAppClient.getGlobalState();
    const totalConsensus4 = gD.totalConsensusRewards!.asBigInt();
    expect(totalConsensus4).toBe(totalConsensus3);
    const commisionAmount4 = gD.commisionAmount!.asBigInt();
    expect(commisionAmount4).toBe(commisionAmount3);
  });

  test('pay commision out', async () => {
    const { appAddress } = await secondAppClient.appClient.getAppReference();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(1000),
    });
    await secondAppClient.payCommision({ payTxn }, { sendParams: { fee: algokit.microAlgos(1000) } });
  });

  test('send algo payment', async () => {
    const { algorand } = fixture;
    const { appAddress } = await secondAppClient.appClient.getAppReference();

    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('balanceBeforePay:', balanceBeforePay);
    await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algoPayment,
    });
    const { amount: balanceAfterPAy } = await algorand.account.getInformation(appAddress);
    console.log('balanceAfterPAy:', balanceAfterPAy);
  });

  test('pickup rewards 3', async () => {
    // check initial state
    const expectedInitialConsensusRewards = (BigInt(algoPayment.microAlgos) / 100n) * 92n;
    const expectedInitialCommisionAmount = (BigInt(algoPayment.microAlgos) / 100n) * 8n;
    const gA = await secondAppClient.getGlobalState();
    const totalConsensus1 = gA.totalConsensusRewards!.asBigInt();
    expect(totalConsensus1).toBe(expectedInitialConsensusRewards * 3n + 920000n);
    const commisionAmount = gA.commisionAmount!.asBigInt();
    expect(commisionAmount).toBe(0n);
    const paidCommision = gA.paidCommision!.asBigInt();
    expect(paidCommision).toBe(expectedInitialCommisionAmount * 3n + 80000n);

    // run pickup rewards
    await secondAppClient.pickupAlgoRewards({}, {});
    const gB = await secondAppClient.getGlobalState();
    const totalConsensus2 = gB.totalConsensusRewards!.asBigInt();
    expect(totalConsensus2).toBe(expectedInitialConsensusRewards * 4n + 920000n);
    const commisionAmount2 = gB.commisionAmount!.asBigInt();
    expect(commisionAmount2).toBe(expectedInitialCommisionAmount);

    await secondAppClient.pickupAlgoRewards({}, {});
    const gC = await secondAppClient.getGlobalState();
    const totalConsensus3 = gC.totalConsensusRewards!.asBigInt();
    expect(totalConsensus3).toBe(totalConsensus2);
    const commisionAmount3 = gC.commisionAmount!.asBigInt();
    expect(commisionAmount3).toBe(commisionAmount2);

    await secondAppClient.pickupAlgoRewards({}, {});
    const gD = await secondAppClient.getGlobalState();
    const totalConsensus4 = gD.totalConsensusRewards!.asBigInt();
    expect(totalConsensus4).toBe(totalConsensus3);
    const commisionAmount4 = gD.commisionAmount!.asBigInt();
    expect(commisionAmount4).toBe(commisionAmount3);
  });

  test('pay commision out', async () => {
    const { appAddress } = await secondAppClient.appClient.getAppReference();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(1000),
    });
    await secondAppClient.payCommision({ payTxn }, { sendParams: { fee: algokit.microAlgos(1000) } });
  });

  test('unstake all', async () => {
    const { algorand } = fixture;
    const { appAddress } = await secondAppClient.appClient.getAppReference();
    const globalState = await secondAppClient.getGlobalState();
    const availableRewards = globalState.totalConsensusRewards!.asBigInt();
    expect(availableRewards).toBeGreaterThan(0n);
    const expectedRewardsPerStaker = availableRewards / BigInt(stakingAccounts.length);
    consoleLogger.info(`availableRewards:${availableRewards.toString()}`);
    consoleLogger.info(`expectedRewardsPerStaker:${expectedRewardsPerStaker.toString()}`);

    const { amount: initialBalanceBeforeAllUnstake } = await algorand.account.getInformation(appAddress);
    console.log('unstake balanceBeforeAllUnstake:', initialBalanceBeforeAllUnstake);

    console.log('number of stakers:', stakingAccounts.length);
    let usercirculatingLST = 0n;
    for (let j = 0; j < stakingAccounts.length; j++) {
      const staker = stakingAccounts[j];
      const { balance: lstBalance } = await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId);
      console.log('staker:', j);
      console.log('lstBalance:', lstBalance);
      usercirculatingLST += lstBalance;
    }

    const circ = globalState.circulatingLST!.asBigInt();
    console.log('usercirculatingLST / circulating:', usercirculatingLST, circ);
    expect(usercirculatingLST).toBe(circ);

    for (let i = 0; i < stakingAccounts.length; i++) {
      console.log('unstaking staker:', i);
      const staker = stakingAccounts[i];
      const globalStateA = await secondAppClient.getGlobalState();
      const circulatingLST = globalStateA.circulatingLST!.asBigInt();
      consoleLogger.info(`circulatingLST:${circulatingLST.toString()}`); // 66890000n

      const { amount: balanceBeforeUnstake } = await algorand.account.getInformation(staker.account!.addr);

      let fees = AlgoAmount.MicroAlgos(240_000);
      const { balance: lstBalance } = await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId);
      console.log('staker unstake, lst balance prior to unstake:', lstBalance);
      consoleLogger.info(`pre burn params,
        totalStake:${globalStateA.totalStaked!.asBigInt()}
        consensusRewards:${globalStateA.totalConsensusRewards!.asBigInt()}
        minimumBalance:${globalStateA.minimumBalance!.asBigInt()}
        user LST balance/quantity: ${lstBalance}`);
      const nodeAlgo = globalStateA.totalStaked!.asBigInt() + globalStateA.totalConsensusRewards!.asBigInt();

      const lstRatio = (nodeAlgo * 10000n) / circulatingLST;
      const algodue = (lstRatio * staker.stake) / 10000n;
      console.log('algo due for unstake:', algodue);

      const axferTxn = await algorand.transactions.assetTransfer({
        sender: staker.account!.addr,
        receiver: appAddress,
        assetId: lstAssetId,
        amount: lstBalance,
      });
      const payTxn = await algorand.transactions.payment({
        sender: staker.account!.addr,
        receiver: appAddress,
        amount: AlgoAmount.MicroAlgos(1000),
      });

      const response = await secondAppClient
        .compose()
        .gas({}, { note: '1' })

        .burnLst(
          { axferTxn, payTxn, quantity: lstBalance, userAddress: staker.account!.addr },
          { sender: staker.account, sendParams: { fee: fees } }
        )
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

      fees = AlgoAmount.MicroAlgos(
        1000 + 1000 * Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
      );
      consoleLogger.info(`unstake fees:${fees.toString()}`);
      axferTxn.group = undefined;
      payTxn.group = undefined;
      await secondAppClient
        .compose()
        .gas({}, { note: '1' })

        .burnLst(
          { axferTxn, payTxn, quantity: lstBalance, userAddress: staker.account!.addr },
          { sender: staker.account, sendParams: { fee: fees } }
        )
        .execute({ populateAppCallResources: true, suppressLog: false });
      const globalStateAfter = await secondAppClient.getGlobalState();

      consoleLogger.info(`burn params,
         totalStake:${globalStateAfter.totalStaked!.asBigInt()}
         consensusRewards:${globalStateAfter.totalConsensusRewards!.asBigInt()}
         minimumBalance:${globalStateAfter.minimumBalance!.asBigInt()}`);

      const { amount: balanceAfterUnstake } = await algorand.account.getInformation(staker.account!.addr);
      console.log('unstake balanceAfterUnstake:', balanceAfterUnstake);
      expect(balanceAfterUnstake).toBeGreaterThan(balanceBeforeUnstake);

      const { amount: appBalanceDuringUnstake } = await algorand.account.getInformation(appAddress);
      console.log('unstake appBalanceDuringUnstake:', appBalanceDuringUnstake);
    }
  }, 600000);

  test.skip('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});
