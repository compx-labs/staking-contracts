import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import algosdk from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { PermissionlessInjectedRewardsPoolClient } from '../../contracts/clients/PermissionlessInjectedRewardsPoolClient';
import { byteArrayToUint128 } from '../utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: PermissionlessInjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let injector: TransactionSignerAccount;
let treasury: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let xUSDAssetId: bigint;
// eslint-disable-next-line camelcase
const xUSD_FEE = 100n;

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true });
  return result.returns![0];
}

describe('Permissionless Injected Reward Pool setup/admin functions - no staking', () => {
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

    await appClient.create.createApplication({
      adminAddress: admin.addr,
      injectorAddress: injector.addr,
      treasuryAddress: admin.addr,
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
        // eslint-disable-next-line camelcase
        xUSDFee: xUSD_FEE,
        xUSDAssetID: xUSDAssetId,
      },
      { sendParams: { fee: algokit.algos(0.2) } }
    );
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetOneId);
    expect(globalState.contractVersion!.asBigInt()).toBe(1000n);
    expect(globalState.xUSDFee!.asBigInt()).toBe(xUSD_FEE);
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
  });

  test('freeze rewards', async () => {
    await appClient.setFreeze({ enabled: true }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const freezeState = globalStateAfter.freeze!.asByteArray();
    const freezreValue = byteArrayToUint128(freezeState);
    expect(freezreValue).toBe(128n);
  });

  test('un-freeze rewards', async () => {
    await appClient.setFreeze({ enabled: false }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const freezeState = globalStateAfter.freeze!.asByteArray();
    const freezreValue = byteArrayToUint128(freezeState);
    expect(freezreValue).toBe(0n);
  });

  test('freeze rewards by non-admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.setFreeze({ enabled: true }, { sender: nonAdminAccount })).rejects.toThrowError();
  });

  test('update injected asa rewards', async () => {
    await appClient.updateInjectedAsaRewards({ injectedASARewards: 10n }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const injectedASARewards = globalStateAfter.injectedASARewards!.asBigInt();
    expect(injectedASARewards).toBe(10n);
  });
  test('update injected asa rewards as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateInjectedAsaRewards({ injectedASARewards: 10n }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('update injected xUSD rewards', async () => {
    await appClient.updateInjectedxUsdRewards({ injectedxUSDRewards: 10n }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const injectedASARewards = globalStateAfter.injectedASARewards!.asBigInt();
    expect(injectedASARewards).toBe(10n);
  });
  test('update injected xUSD rewards as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateInjectedxUsdRewards({ injectedxUSDRewards: 10n }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('update treasury address', async () => {
    await appClient.updateTreasuryAddress({ treasuryAddress: admin.addr }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const treasuryAddress = globalStateAfter.treasuryAddress!.asByteArray();
    expect(algosdk.encodeAddress(treasuryAddress)).toBe(admin.addr);
  });

  test('update treasury address - non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateTreasuryAddress({ treasuryAddress: admin.addr }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('update xUSD fee', async () => {
    await appClient.updatexUsdFee({ xUSDFee: 10n }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const xUSDFee = globalStateAfter.xUSDFee!.asBigInt();
    expect(xUSDFee).toBe(10n);
  });
  test('update xUSD fee as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updatexUsdFee({ xUSDFee: 10n }, { sender: nonAdminAccount })).rejects.toThrowError();
  });

  test('update num stakers', async () => {
    await appClient.updateNumStakers({ numStakers: 10n }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const numStakers = globalStateAfter.numStakers!.asBigInt();
    expect(numStakers).toBe(10n);
  });
  test('update num stakers non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updateNumStakers({ numStakers: 10n }, { sender: nonAdminAccount })).rejects.toThrowError();
  });

  test('set fee waived', async () => {
    await appClient.setFeeWaived({ feeWaived: true }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const feeWaivedState = globalStateAfter.feeWaived!.asByteArray();
    const feeWaived = byteArrayToUint128(feeWaivedState);
    expect(feeWaived).toBe(128n);
    const xUSDFee = globalStateAfter.xUSDFee!.asBigInt();
    expect(xUSDFee).toBe(0n);
  });
  test('set fee waived non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.setFeeWaived({ feeWaived: true }, { sender: nonAdminAccount })).rejects.toThrowError();
  });

  test('update injector address', async () => {
    await appClient.updateInjectorAddress({ injectorAddress: admin.addr }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const injectorAddress = globalStateAfter.injectorAddress!.asByteArray();
    expect(algosdk.encodeAddress(injectorAddress)).toBe(admin.addr);
  });
  test('update injector address non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateInjectorAddress({ injectorAddress: admin.addr }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('activate pool', async () => {
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

  test('set poolEnding true', async () => {
    await appClient.updatePoolEnding({ poolEnding: true }, { sendParams: { fee: algokit.algos(0.01) } });

    const globalStateAfter = await appClient.getGlobalState();
    const poolEndingState = globalStateAfter.poolEnding!.asByteArray();
    const poolEnding = byteArrayToUint128(poolEndingState);
    expect(poolEnding).toBe(128n);
  });

  test('attempt to stake in ending pool', async () => {
    const { algorand } = fixture;
    const { appAddress } = await appClient.appClient.getAppReference();

    const account = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
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
    const stakeTxn = await algorand.transactions.assetTransfer({
      assetId: stakedAssetId,
      amount: staker.stake,
      sender: staker.account!.addr,
      receiver: appAddress,
    });
    const fees = AlgoAmount.MicroAlgos(240_000);
    // expect error as pool is ended
    await expect(
      appClient
        .compose()
        .gas({}, { note: '1' })
        .gas({}, { note: '2' })
        .gas({}, { note: '3' })
        .stake({ quantity: staker.stake, stakeTxn }, { sender: staker.account, sendParams: { fee: fees } })

        .execute({ populateAppCallResources: true, suppressLog: true })
    ).rejects.toThrowError();
  });

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
