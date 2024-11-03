import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { getStakingAccount, StakingAccount } from './utils';
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
let AlgoInjectionAmount = 10n * 10n ** 6n;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;
const BYTE_LENGTH_STAKER = 96;
const COMMISION = 8n;
const numStakers = 250;
let algoPayment: AlgoAmount = algokit.algos(2);
let treasuryAccount: TransactionSignerAccount;
let stakingAccounts: StakingAccount[] = [];
const rewardTokens: bigint[] = [];

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
}

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
        minSpendingBalance: algokit.algos(100),
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
    /* await algokit.ensureFunded(
      {
        accountToFund: treasuryAccount,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(1),
      },
      algorand.client.algod,
    ) */
    await appClient.create.createApplication({
      adminAddress: admin.addr,
      oracleAdminAddress: admin.addr,
      treasuryAddress: treasuryAccount.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(2),
    });

    await appClient.initApplication({
      stakedAsset: 0,
      rewardAssetId: rewardAssetOneId,
      minStakePeriodForRewards: 0n,
      commision: COMMISION,
      lstTokenId: lstAssetId,
      payTxn
    }, { sendParams: { fee: algokit.algos(0.1) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(0n);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(0n);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetOneId);
    expect(globalState.commision!.asBigInt()).toBe(8n);
    expect(globalState.lstTokenId!.asBigInt()).toBe(lstAssetId);
  });

  test('init storage', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('init storage balanceBefore:', balanceBeforePay);

    const [mbrPayment] = await getMBRFromAppClient();
    const payTxn = await algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.microAlgos(Number(mbrPayment)),
    });

    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .gas({}, { note: '4' })
      .initStorage({
        mbrPayment: {
          transaction: payTxn,
          signer: { signer: admin.signer, addr: admin.addr } as TransactionSignerAccount
        },
      },
        {
          sendParams: {
            fee: algokit.algos(0.2),
          },
        },)
      .execute({ populateAppCallResources: true })

    const boxNames = await appClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(1);
    console.log('mbrPayment:', mbrPayment);
    console.log('mbrPayment in algo:', mbrPayment / 10n ** 6n);
    const { amount: balanceAfter } = await algorand.account.getInformation(appAddress);
    console.log('init storage balanceAfter:', balanceAfter);
  });

  test('init stakers', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceBeforePay } = await algorand.account.getInformation(appAddress);
    console.log('init stakers balanceBefore:', balanceBeforePay);
    for (var x = 0; x < numStakers; x++) {

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

  async function accreRewards() {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const globalStateAfter = await appClient.getGlobalState();
    console.log('injectedASARewards:', globalStateAfter.injectedASARewards!.asBigInt());
    const { amount: appBalanceBeforeAccrue } = await algorand.account.getInformation(appAddress);
    console.log('appBalanceBeforeAccrue:', appBalanceBeforeAccrue);

    let accrueRewardsFees = AlgoAmount.MicroAlgos(240_000);
    const accrueSimulateResult = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .gas({}, { note: '4' })
      .accrueRewards({}, { sendParams: { fee: accrueRewardsFees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true })
    accrueRewardsFees = AlgoAmount.MicroAlgos(
      2000 +
      1000 *
      Math.floor(((accrueSimulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    const { amount: appBalanceAfterSim } = await algorand.account.getInformation(appAddress);
    console.log('appBalanceAfterSim:', appBalanceAfterSim);
    consoleLogger.info(`accrueRewards fees:${accrueRewardsFees.toString()}`)
    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .gas({}, { note: '4' })
      .accrueRewards({}, { sendParams: { fee: accrueRewardsFees } })
      .execute({ populateAppCallResources: true })
    const { amount: appBalanceAfterAccrue } = await algorand.account.getInformation(appAddress);
    console.log('appBalanceAfterAccrue:', appBalanceAfterAccrue);

    const stakerBox = await appClient.appClient.getBoxValue('stakers');
    const staker1 = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
    const staker2 = getStakingAccount(stakerBox.slice(BYTE_LENGTH_STAKER, BYTE_LENGTH_STAKER * 2), 8);
    console.log('staker1', staker1);
    console.log('staker2', staker2);
  }

  async function injectAlgo(quantity: number) {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.microAlgos(quantity),
    });
    await appClient.injectAlgoRewards({ payTxn: payTxn, quantity: algokit.microAlgos(quantity).microAlgos });
  }

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
        amount: AlgoAmount.MicroAlgos(Number(staker.stake)),
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

    }
    const { amount: balanceAfterStake } = await algorand.account.getInformation(appAddress);
    console.log('staking balanceAfterStake:', balanceAfterStake);
  }, 600000);

  test('mint lst tokens', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { amount: balanceABeforeMintLST } = await algorand.account.getInformation(appAddress);
    console.log('mintLST balanceABeforeMintLST:', balanceABeforeMintLST);
    for (var staker of stakingAccounts) {
      let fees = AlgoAmount.MicroAlgos(240_000);
      const payTxn = await algorand.transactions.payment({
        sender: staker.account!.addr,
        receiver: appAddress,
        amount: AlgoAmount.MicroAlgos(1000),
      });
      const simulateResults = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .gas({}, { note: '4' })
        .mintLst({ quantity: staker.stake, payTxn },
          {
            sender: staker.account,
            sendParams: { fee: fees }, assets: [Number(lstAssetId)]
          })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      fees = AlgoAmount.MicroAlgos(
        2000 +
        1000 *
        Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
      )
      console.log('mintLst fees:', fees.toString());
      payTxn.group = undefined;
      const results = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .gas({}, { note: '4' })
        .mintLst({ quantity: staker.stake, payTxn },
          {
            sender: staker.account,
            sendParams: { fee: fees }, assets: [Number(lstAssetId)]
          })
        .execute({ populateAppCallResources: true })
      const lstBalance = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId)).balance;
      console.log('lstBalance:', lstBalance);
      expect(lstBalance).toBe(staker.stake);
    };
    const { amount: balanceAfterMintLST } = await algorand.account.getInformation(appAddress);
    console.log('mintLST balanceAfterMintLST:', balanceAfterMintLST);
  }, 600000);

  test('inject rewards ASA ', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: admin.addr,
      receiver: appAddress,
      assetId: rewardAssetOneId,
      amount: ASAInjectionAmount
    });

    await appClient.injectRewards({ rewardTxn: axferTxn, quantity: ASAInjectionAmount, rewardAssetId: rewardAssetOneId },
      { assets: [Number(rewardAssetOneId)], sendParams: { populateAppCallResources: true } });

    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.injectedASARewards!.asBigInt()).toBe(ASAInjectionAmount);
    console.log('injectedASARewards:', globalStateAfter.injectedASARewards!.asBigInt());
  });

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

    const commisionAmount = (BigInt(Number(algoPayment)) / 100n * COMMISION);
    const rewardAmount = (BigInt(Number(algoPayment)) - commisionAmount);

    const globalStateX = await appClient.getGlobalState();

    let calculatedAmount = BigInt(balanceAfterPAy) - globalStateX.minimumBalance!.asBigInt() - globalStateX.totalConsensusRewards!.asBigInt() - globalStateX.algoInjectedRewards!.asBigInt() - globalStateX.totalStaked!.asBigInt();
    console.log('calculation amount: ', BigInt(balanceAfterPAy), globalStateX.minimumBalance!.asBigInt(), globalStateX.totalConsensusRewards!.asBigInt(), globalStateX.algoInjectedRewards!.asBigInt(), globalStateX.totalStaked!.asBigInt());
    const calculatedCommision = calculatedAmount / 100n * COMMISION;



    await appClient.pickupAlgoRewards({}, { sendParams: { fee: algokit.algos(0.01) } });

    const { amount: balanceAfter } = await algorand.account.getInformation(appAddress);
    console.log('balanceAfter:', balanceAfter);

    const globalState = await appClient.getGlobalState();
    console.log('algoInjectedRewards', globalState.algoInjectedRewards!.asBigInt());
    console.log('totalCommision', globalState.totalCommision!.asBigInt());
    console.log('totalConsensusRewards', globalState.totalConsensusRewards!.asBigInt());

    expect(globalState.algoInjectedRewards!.asBigInt()).toBe(rewardAmount);
    expect(globalState.injectedASARewards!.asBigInt()).toBe(ASAInjectionAmount);
    expect(globalState.totalConsensusRewards!.asBigInt()).toBe(rewardAmount);
  });

  test('accreRewards', async () => {
    const { algorand } = fixture;
    const globalState = await appClient.getGlobalState();
    const totalConsensusRewards = globalState.totalConsensusRewards!.asBigInt();
    console.log('totalConsensusRewards:', totalConsensusRewards);
    await accreRewards();
    let index = 0;
    for (var staker of stakingAccounts) {
      const stakerBoxAfter = await appClient.appClient.getBoxValue('stakers');
      const stakerAfter = getStakingAccount(stakerBoxAfter.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      expect(stakerAfter.algoAccuredRewards).toBe(totalConsensusRewards / BigInt(numStakers));
      index += BYTE_LENGTH_STAKER;
    }
  }, 600000);


  test('unstake all', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const totalStakedBefore = (await appClient.getGlobalState()).totalStaked!.asBigInt();
    console.log('totalStakedBefore:', totalStakedBefore);

    for (let i = 0; i < numStakers; i++) {
      const staker = stakingAccounts[i];
      const stakerBox = await appClient.appClient.getBoxValue('stakers');
      const stakerAccount = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
      const ASARewardPending = stakerAccount.accruedASARewards;
      const stake = stakerAccount.stake;
      const { amount: algoBalanceBeforeUnstake } = await algorand.account.getInformation(staker.account!.addr);
      const { balance: asaRewardBalanceBeforeUnstake } = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetOneId));

      console.log('unstake params, address:', staker.account, 'stake:', stake, 'ASARewardPending:', ASARewardPending, 'algoBalanceBeforeUnstake:', algoBalanceBeforeUnstake, 'asaRewardBalanceBeforeUnstake:', asaRewardBalanceBeforeUnstake);
      let fees = AlgoAmount.MicroAlgos(240_000);
      const { balance: lstBalance } = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId));

      const axferTxn = await algorand.transactions.assetTransfer({
        sender: staker.account!.addr,
        receiver: appAddress,
        assetId: lstAssetId,
        amount: lstBalance,
      });
      const response = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .unstake({ axferTxn, percentageQuantity: 100n }, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

      fees = AlgoAmount.MicroAlgos(
        2000 +
        1000 *
        Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),)
      consoleLogger.info(`unstake fees:${fees.toString()}`)
      axferTxn.group = undefined;
      const response2 = await appClient.compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .unstake({ axferTxn, percentageQuantity: 100n }, { sender: staker.account, sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: false })

      const globalStateAfter = await appClient.getGlobalState();
      console.log('last unstake:', globalStateAfter.lastUnstake!.asBigInt());
      const { balance: lstBalanceAfter } = (await algorand.account.getAssetInformation(staker.account!.addr, lstAssetId));
      expect(lstBalanceAfter).toBe(0n);
      const { amount: algoBalanceAfterUnstake } = await algorand.account.getInformation(staker.account!.addr);
      const { balance: asaRewardBalanceAfterUnstake } = (await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetOneId));
      expect(algoBalanceAfterUnstake).toBe(algoBalanceBeforeUnstake + Number(stake) - (fees.microAlgos + 1_000));
      expect(asaRewardBalanceAfterUnstake).toBe(asaRewardBalanceBeforeUnstake + ASARewardPending);
    }
  }, 600000);

  test.skip('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

