import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { byteArrayToUint128, getByteArrayValuesAsBigInts } from '../utils';
import { InjectedRewardsPoolConsensusClient } from '../../contracts/clients/InjectedRewardsPoolConsensusClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: InjectedRewardsPoolConsensusClient;
let admin: TransactionSignerAccount;
let lstAssetId: bigint;
let rewardAssetOneId: bigint;
const ONE_DAY = 86400n;
const BYTE_LENGTH_REWARD_ASSET = 8;

async function getMBRFromAppClient() {
  const result = await appClient.compose().getMbrForPoolCreation({}, {}).simulate({ allowUnnamedResources: true })
  return result.returns![0]
}

describe('Injected Reward Pool setup/admin functions - no staking, specfially set up for algo staking in consensus', () => {
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

    await appClient.create.createApplication({
      adminAddress: admin.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    await fixture.algorand.send.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(20),
    });

    await appClient.initApplication({
      stakedAsset: 0,
      rewardAssetId: rewardAssetOneId,
      minStakePeriodForRewards: ONE_DAY,
      lstTokenId: lstAssetId,
    }, { sendParams: { fee: algokit.algos(0.2) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(0n);
    expect(globalState.lastRewardInjectionTime!.asBigInt()).toBe(0n);
    expect(globalState.minStakePeriodForRewards!.asBigInt()).toBe(ONE_DAY);
    expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetOneId);
    expect(globalState.totalConsensusRewards!.asBigInt()).toBe(0n);
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
  });

  test('update min staking period', async () => {
    await appClient.updateMinStakePeriod({ minStakePeriodForRewards: 2n * ONE_DAY });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.minStakePeriodForRewards!.asBigInt()).toBe(2n * ONE_DAY);
  });

  test('update min staking period by non-admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    await expect(
      appClient.updateMinStakePeriod(
        { minStakePeriodForRewards: 2n * ONE_DAY },
        { sender: nonAdminAccount },
      ),
    ).rejects.toThrowError()
  });


  test('freeze rewards', async () => {
    await appClient.setFreeze({ enabled: true });
    const globalStateAfter = await appClient.getGlobalState();
    const freezeState = globalStateAfter.freeze!.asByteArray();
    const freezreValue = byteArrayToUint128(freezeState);
    expect(freezreValue).toBe(128n);
  });

  test('un-freeze rewards', async () => {
    await appClient.setFreeze({ enabled: false });
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

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

