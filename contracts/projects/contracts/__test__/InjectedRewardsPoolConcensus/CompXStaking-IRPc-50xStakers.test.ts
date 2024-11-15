import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { StakingAccount } from './utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { InjectedRewardsPoolConsensusClient } from '../../contracts/clients/InjectedRewardsPoolConsensusClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolConsensusClient;
let admin: TransactionSignerAccount;
let lstAssetId: bigint;
let rewardAssetOneId: bigint;
let ASAInjectionAmount = 10n * 10n ** 6n;
const COMMISION = 8n;
let initialStakers = 100;
let algoPayment: AlgoAmount = algokit.algos(initialStakers + 1);
let treasuryAccount: TransactionSignerAccount;
let stakingAccounts: StakingAccount[] = [];
const rewardTokens: bigint[] = [];

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
      algorand.client.algod,
    )

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

    await appClient.create.createApplication({
      adminAddress: admin.addr,
      treasuryAddress: treasuryAccount.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(0.3),
    });

    await appClient.initApplication({
      stakedAsset: 0,
      rewardAssetId: rewardAssetOneId,
      commision: COMMISION,
      lstTokenId: lstAssetId,
      payTxn
    }, { sendParams: { fee: algokit.algos(0.1) } });
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
        account: account,
        stake: 10n * 10n ** 6n,
      };

      for (var i = 0; i < rewardTokens.length; i++) {
        await algorand.send.assetTransfer({
          assetId: rewardTokens[i],
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        }, { suppressLog: true });
      }
      await algorand.send.assetTransfer({
        assetId: lstAssetId,
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
      }, { suppressLog: true });

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
    await appClient.addLst({ axferTxn, quantity: 100_000_000_000n }, { sender: admin, sendParams: { fee: algokit.algos(0.1) }, assets: [Number(lstAssetId)] });
    const lstBalance = (await algorand.account.getAssetInformation(appAddress, lstAssetId)).balance;
    expect(lstBalance).toBe(100_000_000_000n);
    const { amount: balanceAfterlst } = await algorand.account.getInformation(appAddress);
    console.log('send lst balanceAfterlst:', balanceAfterlst);
  });



  test('staking', async () => {
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
      const simulateResults = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, payTxn: payTxn },
          { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      payTxn.group = undefined;
      fees = AlgoAmount.MicroAlgos(
        1000 +
        1000 *
        Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
      )
      consoleLogger.info(`addStake fees:${fees.toString()}`)
      const results = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .stake({ quantity: staker.stake, payTxn: payTxn },
          { sender: staker.account, sendParams: { fee: fees } })

        .execute({ populateAppCallResources: true, suppressLog: true })

      const { amount: balanceAfterStake } = await algorand.account.getInformation(appAddress);
      console.log('staking balanceAfterStake:', balanceAfterStake);
      const lstBalance = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId)).balance;
      console.log('lstBalance:', lstBalance);
      expect(lstBalance).toBe(staker.stake);
    }

  }, 600000);



  test('send algo payment', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('balanceBeforePay:', balanceBeforePay);
    const payTxn = await algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algoPayment,
    });
    const { amount: balanceAfterPAy } = await algorand.account.getInformation(appAddress);
    console.log('balanceAfterPAy:', balanceAfterPAy);
  });

  test('pickup rewards', async () => {
    //check initial state
    const gA = await appClient.getGlobalState();
    const totalConsensus1 = gA.totalConsensusRewards!.asBigInt();
    expect(totalConsensus1).toBe(0n);
    const commisionAmount = gA.commisionAmount!.asBigInt();
    expect(commisionAmount).toBe(0n);

    //run pickup rewards
    await appClient.pickupAlgoRewards({}, {});
    const gB = await appClient.getGlobalState();
    const totalConsensus2 = gB.totalConsensusRewards!.asBigInt();
    expect(totalConsensus2).toBeGreaterThan(0n);
    const commisionAmount2 = gB.commisionAmount!.asBigInt();
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

  test('pay commision out', async () => {
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: appBalanceBefore } = await fixture.algorand.account.getInformation(appAddress);
    const { amount: balanceBeforeCommision } = await fixture.algorand.account.getInformation(treasuryAccount.addr);
    const globalState = await appClient.getGlobalState();
    const commisionAmount = globalState.commisionAmount!.asBigInt();
    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(1000),
    });
    await appClient.payCommision({ payTxn }, { sendParams: { fee: algokit.microAlgos(1000) } });
    const { amount: balanceAfterCommision } = await fixture.algorand.account.getInformation(treasuryAccount.addr);
    expect(balanceAfterCommision).toBe(balanceBeforeCommision + Number(commisionAmount));
    const { amount: appBalanceAfter } = await fixture.algorand.account.getInformation(appAddress);
  });

  test('add new staker', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceBeforeStake } = await algorand.account.getInformation(appAddress);
    console.log('staking balanceBeforeStake2:', balanceBeforeStake);
    const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(100), suppressLog: true });
    const staker = {
      account: account,
      stake: 10n * 10n ** 6n,
    };

    for (var i = 0; i < rewardTokens.length; i++) {
      await algorand.send.assetTransfer({
        assetId: rewardTokens[i],
        amount: 0n,
        sender: staker.account.addr,
        receiver: staker.account.addr,
      }, { suppressLog: true });
    }
    await algorand.send.assetTransfer({
      assetId: lstAssetId,
      amount: 0n,
      sender: staker.account.addr,
      receiver: staker.account.addr,
    }, { suppressLog: true });

    stakingAccounts.push(staker);

    const payTxn = await algorand.transactions.payment({
      sender: staker.account!.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(Number(staker.stake) + 1000),
    });
    let fees = AlgoAmount.MicroAlgos(240_000);
    const simulateResults = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn: payTxn },
        { sender: staker.account, sendParams: { fee: fees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

    payTxn.group = undefined;
    fees = AlgoAmount.MicroAlgos(
      1000 +
      1000 *
      Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`addStake fees:${fees.toString()}`)
    const results = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn: payTxn },
        { sender: staker.account, sendParams: { fee: fees } })

      .execute({ populateAppCallResources: true, suppressLog: true })
    const { amount: balanceAfterStake } = await algorand.account.getInformation(appAddress);
    console.log('staking balanceAfterStake2:', balanceAfterStake);
    const lstBalance = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId)).balance;
    console.log('lstBalance:', lstBalance);
    expect(lstBalance).toBe(staker.stake);

  });

  test.skip('add more stake as staker[0] ', async () => {
    const staker = stakingAccounts[0];
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const payTxn = await algorand.transactions.payment({
      sender: staker.account!.addr,
      receiver: appAddress,
      amount: AlgoAmount.MicroAlgos(Number(staker.stake) + 1000),
    });
    let fees = AlgoAmount.MicroAlgos(240_000);
    const simulateResults = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn: payTxn },
        { sender: staker.account, sendParams: { fee: fees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

    payTxn.group = undefined;
    fees = AlgoAmount.MicroAlgos(
      1000 +
      1000 *
      Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`addStake fees:${fees.toString()}`)
    const results = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .stake({ quantity: staker.stake, payTxn: payTxn },
        { sender: staker.account, sendParams: { fee: fees } })

      .execute({ populateAppCallResources: true, suppressLog: true })

    const { balance: lstBalanceafterStake } = await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId);
    expect(lstBalanceafterStake).toBe(staker.stake * 2n);
    stakingAccounts[0].stake = staker.stake * 2n;
  });


  test('unstake all', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const globalState = await appClient.getGlobalState();
    const availableRewards = globalState.totalConsensusRewards!.asBigInt();
    expect(availableRewards).toBeGreaterThan(0n);
    const expectedRewardsPerStaker = availableRewards / BigInt(stakingAccounts.length);
    consoleLogger.info(`availableRewards:${availableRewards.toString()}`)
    consoleLogger.info(`expectedRewardsPerStaker:${expectedRewardsPerStaker.toString()}`)

    const { amount: initialBalanceBeforeAllUnstake } = await algorand.account.getInformation(appAddress);
    console.log('unstake balanceBeforeAllUnstake:', initialBalanceBeforeAllUnstake);

    for (let i = 0; i < stakingAccounts.length; i++) {
      console.log('unstaking staker:', i);
      const staker = stakingAccounts[i];
      const globalStateA = await appClient.getGlobalState();
      const circulatingLST = globalStateA.circulatingLST!.asBigInt();
      consoleLogger.info(`circulatingLST:${circulatingLST.toString()}`)
      const { amount: balanceBeforeUnstake } = await algorand.account.getInformation(staker.account!.addr);

      let fees = AlgoAmount.MicroAlgos(240_000);
      const { balance: lstBalance } = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId));

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

      const response = await appClient.compose()
        .gas({}, { note: '1' })

        .burnLst({ axferTxn, payTxn, quantity: lstBalance, userAddress: staker.account!.addr }, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      fees = AlgoAmount.MicroAlgos(
        1000 +
        1000 *
        Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),)
      consoleLogger.info(`unstake fees:${fees.toString()}`)
      axferTxn.group = undefined;
      payTxn.group = undefined;
      const response2 = await appClient.compose()
        .gas({}, { note: '1' })

        .burnLst({ axferTxn, payTxn, quantity: lstBalance, userAddress: staker.account!.addr }, { sender: staker.account, sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: false });
      const globalStateAfter = await appClient.getGlobalState();

      consoleLogger.info(`burn params,
         totalStake:${globalStateAfter.totalStaked!.asBigInt()}
         consensusRewards:${globalStateAfter.totalConsensusRewards!.asBigInt()}
         minimumBalance:${globalStateAfter.minimumBalance!.asBigInt()}`)

      const expectedAmountDue = expectedRewardsPerStaker + staker.stake;

      const { amount: balanceAfterUnstake } = await algorand.account.getInformation(staker.account!.addr);
      console.log('unstake balanceAfterUnstake:', balanceAfterUnstake);
      expect(balanceAfterUnstake).toBeGreaterThan(balanceBeforeUnstake);
      expect(BigInt(balanceAfterUnstake)).toBe(BigInt(balanceBeforeUnstake) + expectedRewardsPerStaker + staker.stake - BigInt(Number(fees)) - 3000n);

      const { amount: appBalanceDuringUnstake } = await algorand.account.getInformation(appAddress);
      console.log('unstake appBalanceDuringUnstake:', appBalanceDuringUnstake);

    }
  }, 600000);

  test.skip('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

