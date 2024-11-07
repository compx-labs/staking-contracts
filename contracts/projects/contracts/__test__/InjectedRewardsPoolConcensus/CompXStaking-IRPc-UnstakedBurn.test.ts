import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { InjectedRewardsPoolClient } from '../../contracts/clients/InjectedRewardsPoolClient';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { getStakingAccount, StakingAccount } from './utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { InjectedRewardsPoolConsensusClient } from '../../contracts/clients/InjectedRewardsPoolConsensusClient';
import algosdk from 'algosdk';

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
const STAKE_AMOUNT = 10n * 10n ** 6n;
const COMMISION = 8n;
const numStakers = 2;
let algoPayment: AlgoAmount = algokit.algos(2);
let treasuryAccount: TransactionSignerAccount;
let stakingAccounts: StakingAccount[] = [];
const rewardTokens: bigint[] = [];

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
}

describe('Injected Reward Pool consensus - unstaked burn test', () => {
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
        stake: STAKE_AMOUNT,
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

  test('set Prices', async () => {

    await appClient.setPrices({
      stakeTokenPrice: 1000000n,
      lstPrice: 1200000n,
    });
    const stakedTokenPrice = (await appClient.getGlobalState()).stakeTokenPrice!.asBigInt();
    const rewardTokenPrice = (await appClient.getGlobalState()).lstPrice!.asBigInt();
    expect(stakedTokenPrice).toBe(1000000n);
    expect(rewardTokenPrice).toBe(1200000n);
  });

  test('send lst to 3rd account and burn', async () => {
    const thirdPartyAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(100), suppressLog: true });
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const { balance: balanceBeforeSendLst } = await algorand.account.getAssetInformation(stakingAccounts[0].account!.addr, lstAssetId);
    expect(balanceBeforeSendLst).toBe(STAKE_AMOUNT);

    //Check contract balance prior to burn
    const { balance: balanceBeforeBurn } = await algorand.account.getAssetInformation(appAddress, lstAssetId);
    expect(balanceBeforeBurn).toBeGreaterThan(0n);

    const optIn = await algorand.send.assetTransfer({
      sender: thirdPartyAccount.addr,
      receiver: thirdPartyAccount.addr,
      assetId: lstAssetId,
      amount: 0n,

    });

    const axferTxn = await algorand.send.assetTransfer({
      sender: stakingAccounts[0].account!.addr,
      receiver: thirdPartyAccount.addr,
      assetId: lstAssetId,
      amount: STAKE_AMOUNT,
    });

    const burnTxn = await algorand.transactions.assetTransfer({
      sender: thirdPartyAccount.addr,
      receiver: appAddress,
      assetId: lstAssetId,
      amount: STAKE_AMOUNT,
    });


    const { balance: balanceAfterSendLst } = await algorand.account.getAssetInformation(stakingAccounts[0].account!.addr, lstAssetId);
    expect(balanceAfterSendLst).toBe(0n);
    const { balance: balanceAfterSendLstThirdParty } = await algorand.account.getAssetInformation(thirdPartyAccount, lstAssetId);
    expect(balanceAfterSendLstThirdParty).toBe(STAKE_AMOUNT);

    let fees = AlgoAmount.MicroAlgos(240_000);
    const simulateResults = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .burnLst({ axferTxn: burnTxn, quantity: STAKE_AMOUNT }, {
        sender: thirdPartyAccount, sendParams: { fee: fees }, assets: [Number(lstAssetId)]
      })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true })

    burnTxn.group = undefined;
    fees = AlgoAmount.MicroAlgos(
      1000 *
      Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700),
    )
    consoleLogger.info(`burn lst fees:${fees.toString()}`)

    const executeResults = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .burnLst({ axferTxn: burnTxn, quantity: STAKE_AMOUNT }, {
        sender: thirdPartyAccount, sendParams: { fee: algokit.algos(0.1) }, assets: [Number(lstAssetId)]
      })
      .execute({ populateAppCallResources: true })

    const { balance: balanceAfterBurn } = await algorand.account.getAssetInformation(thirdPartyAccount, lstAssetId);
    expect(balanceAfterBurn).toBe(0n);
    const { balance: balanceAfterBurnContract } = await algorand.account.getAssetInformation(appAddress, lstAssetId);
    expect(balanceAfterBurnContract).toBe(balanceBeforeBurn + STAKE_AMOUNT);
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

