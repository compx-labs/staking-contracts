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
      treasuryAddress: admin.addr,
    });
    const { appAddress } = await appClient.appClient.getAppReference();

    const payTxn = await fixture.algorand.transactions.payment({
      sender: admin.addr,
      receiver: appAddress,
      amount: algokit.algos(20),
    });

    await appClient.initApplication({
      lstTokenId: lstAssetId,
      commision: 8n,
      payTxn
    }, { sendParams: { fee: algokit.algos(0.2) } });
  });

  test('confirm global state on initialisation', async () => {
    const globalState = await appClient.getGlobalState();
    expect(globalState.stakedAssetId!.asBigInt()).toBe(0n);
  });


  test('update commision', async () => {
    const globalStateBefore = await appClient.getGlobalState();
    expect(globalStateBefore.commisionPercentage!.asBigInt()).toBe(8n);
    await appClient.updateCommision({ commision: 10n });
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.commisionPercentage!.asBigInt()).toBe(10n);
  });

  test('update commision non-admin', async () => {
    const nonAdminAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
    const globalStateBefore = await appClient.getGlobalState();
    expect(globalStateBefore.commisionPercentage!.asBigInt()).toBe(10n);
    await expect(
      appClient.updateCommision({ commision: 5n }, { sender: nonAdminAccount }),
    ).rejects.toThrowError();
    const globalStateAfter = await appClient.getGlobalState();
    expect(globalStateAfter.commisionPercentage!.asBigInt()).toBe(10n);
  });

  test('deleteApplication', async () => {
    await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
  });
});

