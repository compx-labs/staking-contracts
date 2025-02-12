/* eslint-disable no-await-in-loop */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { byteArrayToUint128, getStakingAccount, StakingAccount } from './utils';
import { PermissionlessInjectedRewardsPoolClient } from '../../contracts/clients/PermissionlessInjectedRewardsPoolClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: PermissionlessInjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let injector: TransactionSignerAccount;
let treasury: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let xUSDAssetId: bigint;
const ASAInjectionAmount = 10n * 10n ** 6n;
const xUSDInjectionAmount = 10n * 10n ** 6n;
const BYTE_LENGTH_STAKER = 56;
const numStakers = 5;
const stakingAccounts: StakingAccount[] = [];

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true });
  return result.returns![0];
}

describe('Permissionless Injected Reward Pool - 50x stakers test', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    admin = testAccount;

    appClient = new PermissionlessInjectedRewardsPoolClient(
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
      algorand.client.algod
    );

    injector = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await algokit.ensureFunded(
      {
        accountToFund: injector,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(100),
      },
      algorand.client.algod
    );
    treasury = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await algokit.ensureFunded(
      {
        accountToFund: treasury,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(100),
      },
      algorand.client.algod
    );

    const stakeAssetCreate = algorand.send.assetCreate({
      sender: admin.addr,
      total: 999_999_999_000n,
      decimals: 6,
      assetName: 'Stake Token',
    });
    stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);

    const rewardAssetOneCreate = algorand.send.assetCreate({
      sender: injector.addr,
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

    await appClient.create.createApplication({
      adminAddress: admin.addr,
      injectorAddress: injector.addr,
      treasuryAddress: treasury.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    await fixture.algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(20),
    });

    await appClient.initApplication(
      {
        stakedAsset: stakedAssetId,
        rewardAssetId: rewardAssetOneId,
        xUSDAssetID: xUSDAssetId,
        xUSDFee: 100n,
      },
      { sendParams: { fee: algokit.algos(0.1) } }
    );
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetOneId);
    expect(globalState.xUSDAssetId!.asBigInt()).toBe(xUSDAssetId);
    expect(globalState.xUSDFee!.asBigInt()).toBe(100n);
  });

  test('init storage', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const [mbrPayment] = await getMBRFromAppClient();
    const payTxn = await algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.microAlgos(Number(mbrPayment)),
    });

    await appClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .initStorage(
        {
          mbrPayment: {
            transaction: payTxn,
            signer: { signer: admin.signer, addr: admin.addr } as TransactionSignerAccount,
          },
        },
        {
          sendParams: {
            fee: algokit.algos(0.2),
          },
        }
      )
      .execute({ populateAppCallResources: true });

    const boxNames = await appClient.appClient.getBoxNames();
    expect(boxNames.length).toBe(1);
    console.log('mbrPayment:', mbrPayment);
    console.log('mbrPayment in algo:', mbrPayment / 10n ** 6n);
  });

  test('init injector account', async () => {
    const { algorand } = fixture;

    await algorand.send.assetTransfer(
      {
        assetId: stakedAssetId,
        amount: 0n,
        sender: injector.addr,
        receiver: injector.addr,
      },
      { suppressLog: true }
    );
    await algorand.send.assetTransfer(
      {
        assetId: rewardAssetOneId,
        amount: 0n,
        sender: injector.addr,
        receiver: injector.addr,
      },
      { suppressLog: true }
    );
    await algorand.send.assetTransfer(
      {
        assetId: xUSDAssetId,
        amount: 0n,
        sender: injector.addr,
        receiver: injector.addr,
      },
      { suppressLog: true }
    );
    await algorand.send.assetTransfer(
      {
        assetId: xUSDAssetId,
        amount: 100_000_000_000n,
        sender: admin.addr,
        receiver: injector.addr,
      },
      { suppressLog: true }
    );
  });

  test('init stakers', async () => {
    const { algorand } = fixture;
    // eslint-disable-next-line no-plusplus
    for (let x = 0; x < numStakers; x++) {
      // eslint-disable-next-line no-await-in-loop
      const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10), suppressLog: true });
      const staker = {
        account,
        stake: 10n * 10n ** 6n,
      };

      await algorand.send.assetTransfer(
        {
          assetId: stakedAssetId,
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        },
        { suppressLog: true }
      );
      await algorand.send.assetTransfer(
        {
          assetId: rewardAssetOneId,
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        },
        { suppressLog: true }
      );
      await algorand.send.assetTransfer(
        {
          assetId: xUSDAssetId,
          amount: 0n,
          sender: staker.account.addr,
          receiver: staker.account.addr,
        },
        { suppressLog: true }
      );

      await algorand.send.assetTransfer(
        {
          assetId: stakedAssetId,
          amount: staker.stake,
          sender: admin.addr,
          receiver: staker.account.addr,
        },
        { suppressLog: true }
      );
      stakingAccounts.push(staker);
      // console.log('new staker created number ', x)
    }
  }, 600000);

  test('activate pool', async () => {
    await appClient.setFeeWaived({ waiveFee: true }, { sender: injector, sendParams: { fee: algokit.algos(0.01) } });

    await appClient.setRewardParams(
      { rewardFrequency: 86400n, rewardPerInjection: 10_000_000, totalRewards: 100_000_000, injectionType: 0 },
      { sender: admin, sendParams: { fee: algokit.algos(0.01) } }
    );
    const globalState = await appClient.getGlobalState();
    expect(globalState.rewardFrequency!.asBigInt()).toBe(86400n);
    expect(globalState.rewardPerInjection!.asBigInt()).toBe(10_000_000n);
    expect(globalState.totalRewards!.asBigInt()).toBe(100_000_000n);
    await appClient.setPoolActive({}, { sender: admin, sendParams: { fee: algokit.algos(0.01) } });
    const globalStateAfter = await appClient.getGlobalState();
    const activeState = globalStateAfter.poolActive!.asByteArray();
    const active = byteArrayToUint128(activeState);
    expect(active).toBe(128n);
  });

  async function accrueRewards() {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    let accrueRewardsFees = AlgoAmount.MicroAlgos(240_000);
    const accrueSimulateResult = await appClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .accrueRewards({}, { sendParams: { fee: accrueRewardsFees } })
      .simulate({ allowUnnamedResources: true, allowMoreLogging: true });
    accrueRewardsFees = AlgoAmount.MicroAlgos(
      2000 +
        1000 * Math.floor(((accrueSimulateResult.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
    );
    const response = await appClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .accrueRewards({}, { sendParams: { fee: accrueRewardsFees } })
      .execute({ populateAppCallResources: true });

    const stakerBox = await appClient.appClient.getBoxValue('stakers');
    const staker1 = getStakingAccount(stakerBox.slice(0, BYTE_LENGTH_STAKER), 8);
    const staker2 = getStakingAccount(stakerBox.slice(BYTE_LENGTH_STAKER, BYTE_LENGTH_STAKER * 2), 8);
    console.log('staker1', staker1);
    console.log('staker2', staker2);
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.injectedASARewards!.asBigInt()).toBe(0n);
    expect(globalStateAfter.injectedxUSDRewards!.asBigInt()).toBe(0n);
  }

  test('staking', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    // eslint-disable-next-line no-restricted-syntax
    for (const staker of stakingAccounts) {
      const stakerBalance = (await algorand.account.getAssetInformation(staker.account!.addr, stakedAssetId)).balance;
      expect(stakerBalance).toBeGreaterThan(0n);

      const stakeTxn = await algorand.transactions.assetTransfer({
        assetId: stakedAssetId,
        amount: staker.stake,
        sender: staker.account!.addr,
        receiver: appAddress,
      });
      let fees = AlgoAmount.MicroAlgos(240_000);
      const simulateResults = await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .stake({ quantity: staker.stake, stakeTxn }, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

      stakeTxn.group = undefined;
      fees = AlgoAmount.MicroAlgos(
        2000 + 1000 * Math.floor(((simulateResults.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
      );
      consoleLogger.info(`addStake fees:${fees.toString()}`);
      await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .stake({ quantity: staker.stake, stakeTxn }, { sender: staker.account, sendParams: { fee: fees } })

        .execute({ populateAppCallResources: true, suppressLog: true });
    }
  }, 60000);

  test('inject rewards ASA ', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: injector.addr,
      receiver: appAddress,
      assetId: rewardAssetOneId,
      amount: ASAInjectionAmount,
    });

    await appClient.injectRewards(
      { rewardTxn: axferTxn, quantity: ASAInjectionAmount, rewardAssetId: rewardAssetOneId },
      { sender: injector, assets: [Number(rewardAssetOneId)], sendParams: { populateAppCallResources: true } }
    );

    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.injectedASARewards!.asBigInt()).toBe(ASAInjectionAmount);
  });

  test('inject rewards xUSD ', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const axferTxn = await algorand.transactions.assetTransfer({
      sender: injector.addr,
      receiver: appAddress,
      assetId: xUSDAssetId,
      amount: xUSDInjectionAmount,
    });

    await appClient.injectxUsd(
      { xUSDTxn: axferTxn, quantity: xUSDInjectionAmount },
      { sender: injector, assets: [Number(xUSDAssetId)], sendParams: { populateAppCallResources: true } }
    );

    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.injectedxUSDRewards!.asBigInt()).toBe(xUSDInjectionAmount);
  });

  test('accrueRewards', async () => {
    await accrueRewards();
  }, 60000);

  test('claim rewards', async () => {
    const { algorand } = fixture;
    let index = 0;
    // eslint-disable-next-line no-restricted-syntax
    for (const staker of stakingAccounts) {
      const stakerBoxBefore = await appClient.appClient.getBoxValue('stakers');
      const stakerBefore = getStakingAccount(stakerBoxBefore.slice(index, BYTE_LENGTH_STAKER * (index + 1)), 8);
      console.log('stakerBefore', stakerBefore);
      expect(stakerBefore.accruedASARewards).toBe(ASAInjectionAmount / BigInt(numStakers));
      expect(stakerBefore.accruedxUSDRewards).toBe(xUSDInjectionAmount / BigInt(numStakers));

      const stakerASARewardBalanceBefore = (
        await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetOneId)
      ).balance;
      expect(stakerASARewardBalanceBefore).toBe(0n);
      const stakerxUSDRewardBalanceBefore = (
        await algorand.account.getAssetInformation(staker.account!.addr, xUSDAssetId)
      ).balance;
      expect(stakerxUSDRewardBalanceBefore).toBe(0n);

      // check accrued rewards
      let fees = AlgoAmount.MicroAlgos(240_000);
      const response = await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .gas({}, { note: '4' })
        .claimRewards({}, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

      fees = AlgoAmount.MicroAlgos(
        2000 + 1000 * Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
      );

      await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .gas({}, { note: '4' })
        .claimRewards({}, { sender: staker.account, sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: true });

      const stakerASARewardBalanceAfter = (
        await algorand.account.getAssetInformation(staker.account!.addr, rewardAssetOneId)
      ).balance;
      expect(stakerASARewardBalanceAfter).toBe(ASAInjectionAmount / BigInt(numStakers));
      const stakerxUSDRewardBalanceAfter = (
        await algorand.account.getAssetInformation(staker.account!.addr, xUSDAssetId)
      ).balance;
      expect(stakerxUSDRewardBalanceAfter).toBe(xUSDInjectionAmount / BigInt(numStakers));

      index += BYTE_LENGTH_STAKER;
    }
  }, 60000);

  test('unstake all', async () => {
    // check contract address balances
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();
    const stakedAssetBalance = (await algorand.account.getAssetInformation(appAddress, stakedAssetId)).balance;
    const rewardAssetBalance = (await algorand.account.getAssetInformation(appAddress, rewardAssetOneId)).balance;
    const xUSDBalance = (await algorand.account.getAssetInformation(appAddress, xUSDAssetId)).balance;

    console.log('stakedAssetBalance', stakedAssetBalance);
    console.log('rewardAssetBalance', rewardAssetBalance);
    console.log('xUSDBalance', xUSDBalance);

    // eslint-disable-next-line no-restricted-syntax
    for (const staker of stakingAccounts) {
      let fees = AlgoAmount.MicroAlgos(240_000);
      const response = await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .gas({}, { note: '4' })
        .unstake({ quantity: 0 }, { sender: staker.account, sendParams: { fee: fees } })
        .simulate({ allowUnnamedResources: true, allowMoreLogging: true });

      fees = AlgoAmount.MicroAlgos(
        2000 + 1000 * Math.floor(((response.simulateResponse.txnGroups[0].appBudgetAdded as number) + 699) / 700)
      );
      await appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .gas({}, { note: '4' })
        .unstake({ quantity: 0 }, { sender: staker.account, sendParams: { fee: fees } })
        .execute({ populateAppCallResources: true, suppressLog: true });
    }
  }, 60000);

  test('deleteApplication', async () => {
    await appClient
      .compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
      .delete.deleteApplication(
        {},
        {
          sendParams: {
            fee: AlgoAmount.MicroAlgos(2000),
          },
          sender: admin,
        }
      )
      .execute({ populateAppCallResources: true });
  });
});
