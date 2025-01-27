import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { PermissionlessInjectedRewardsPoolClient } from '../../contracts/clients/PermissionlessInjectedRewardsPoolClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts } from '../utils';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: PermissionlessInjectedRewardsPoolClient;
let admin: TransactionSignerAccount;
let injector: TransactionSignerAccount;
let stakedAssetId: bigint;
let rewardAssetOneId: bigint;
let xUSDAssetId: bigint;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;
const xUSD_FEE = 100n;

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
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
      algorand.client.algod,
    )
    injector = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await algokit.ensureFunded(
      {
        accountToFund: injector,
        fundingSource: await algokit.getDispenserAccount(algorand.client.algod, algorand.client.kmd!),
        minSpendingBalance: algokit.algos(100),
      },
      algorand.client.algod,
    )

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
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    await fixture.algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(20),
    });

    await appClient.initApplication({
      stakedAsset: stakedAssetId,
      rewardAssetId: rewardAssetOneId,
      xUSDFee: xUSD_FEE,
      xUSDAssetID: xUSDAssetId,
    }, { sendParams: { fee: algokit.algos(0.2) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetOneId);
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

    const response = await appClient.compose()
      .gas({}, { note: '1' })
      .gas({}, { note: '2' })
      .gas({}, { note: '3' })
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
    await expect(
      appClient.setFreeze({ enabled: true }, { sender: nonAdminAccount }),
    ).rejects.toThrowError()
  });

  test('update injected asa rewards', async () => {
    await appClient.updateInjectedAsaRewards({ injectedASARewards: 10n }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const injectedASARewards = globalStateAfter.injectedASARewards!.asBigInt();
    expect(injectedASARewards).toBe(10n);
  });
  test('update injected asa rewards as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updateInjectedAsaRewards({ injectedASARewards: 10n }, { sender: nonAdminAccount }))
      .rejects.toThrowError();
  });

  test('update injected xUSD rewards', async () => {
    await appClient.updateInjectedxUsdRewards({ injectedxUSDRewards: 10n }, { sender: injector })
    const globalStateAfter = await appClient.getGlobalState();
    const injectedASARewards = globalStateAfter.injectedASARewards!.asBigInt();
    expect(injectedASARewards).toBe(10n);
  });
  test('update injected xUSD rewards as non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updateInjectedxUsdRewards({ injectedxUSDRewards: 10n }, { sender: nonAdminAccount }))
      .rejects.toThrowError();
  });

  test('update treasury address', async () => {
    await appClient.updateTreasuryAddress({ treasuryAddress: admin.addr }, { sender: injector })
    const globalStateAfter = await appClient.getGlobalState();
    const treasuryAddress = globalStateAfter.treasuryAddress!.asByteArray();
    expect(algosdk.encodeAddress(treasuryAddress)).toBe(admin.addr);
  });

  test('update treasury address - non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updateTreasuryAddress({ treasuryAddress: admin.addr }, { sender: nonAdminAccount })
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
    await expect(appClient.updatexUsdFee({ xUSDFee: 10n }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });



  test('update num stakers', async () => {
    await appClient.updateNumStakers({ numStakers: 10n }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const numStakers = globalStateAfter.numStakers!.asBigInt();
    expect(numStakers).toBe(10n);
  });
  test('update num stakers non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updateNumStakers({ numStakers: 10n }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('set fee waived', async () => {
    console.log('injector address', injector.addr);
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
    await expect(appClient.setFeeWaived({ feeWaived: true }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('update injector address', async () => {
    await appClient.updateInjectorAddress({ injectorAddress: admin.addr }, { sender: injector });
    const globalStateAfter = await appClient.getGlobalState();
    const injectorAddress = globalStateAfter.injectorAddress!.asByteArray();
    expect(algosdk.encodeAddress(injectorAddress)).toBe(admin.addr);
  });
  test('update injector address non admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(appClient.updateInjectorAddress({ injectorAddress: admin.addr }, { sender: nonAdminAccount })
    ).rejects.toThrowError();
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

