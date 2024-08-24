import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';

import { CompXStakingClient } from '../../contracts/clients/CompXStakingClient';
import algosdk, { TransactionSigner } from 'algosdk';
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: CompXStakingClient;
let admin: string;
let stakedAssetId: bigint;
let rewardAssetId: bigint;
const PRECISION = 10000n;
let stakingAccount: TransactionSignerAccount;


describe('CompXStaking ASA/Algo - adminUnstake', () => {
    beforeEach(fixture.beforeEach);

    beforeAll(async () => {
        await fixture.beforeEach();
        const { testAccount } = fixture.context;
        const { algorand } = fixture;
        admin = testAccount.addr;

        appClient = new CompXStakingClient(
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
                minSpendingBalance: algokit.algos(10010),
            },
            algorand.client.algod,
        )


        const stakeAssetCreate = algorand.send.assetCreate({
            sender: admin,
            total: 999_999_999_000n,
            decimals: 6,
        });
        stakedAssetId = BigInt((await stakeAssetCreate).confirmation.assetIndex!);
        rewardAssetId = 0n;

        await appClient.create.createApplication({
            stakedAsset: stakedAssetId,
            rewardAsset: rewardAssetId,
            minLockUp: 10n,
            contractDuration: 2592000n, // 30 Days
            startTimestamp: BigInt(Math.floor(Date.now() / 1000)),
            oracleAdmin: admin,
            adminAddress: admin,
        });
    });

    test('confirm global state on initialisation', async () => {
        const globalState = await appClient.getGlobalState();
        expect(globalState.stakeTokenPrice!.asBigInt()).toBe(0n);
        expect(globalState.rewardTokenPrice!.asBigInt()).toBe(0n);
        expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
        expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
        expect(globalState.minLockUp!.asBigInt()).toBe(10n);
        expect(globalState.contractDuration!.asBigInt()).toBe(2592000n);
        expect(globalState.rewardsAvailablePerTick!.asBigInt()).toBe(0n);
        expect(globalState.totalStakingWeight!.asBigInt()).toBe(0n);
        expect(algosdk.encodeAddress(globalState.oracleAdminAddress!.asByteArray())).toBe(admin);
    });

    test('opt app in', async () => {
        const { algorand } = fixture;
        const { appAddress } = await appClient.appClient.getAppReference();

        await algorand.send.payment({
            sender: admin,
            receiver: appAddress,
            amount: algokit.algos(1),
        });

        await appClient.optInToAsset({ asset: stakedAssetId }, { sendParams: { fee: algokit.algos(0.1) } });

        const { balance: stakedAssetBalance } = await algorand.account.getAssetInformation(appAddress, stakedAssetId);
        const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
        expect(stakedAssetBalance).toBe(0n);
        expect(rewardAssetBalance).toBe(algokit.algos(1).microAlgos);
    });

    test('add rewards', async () => {
        const { algorand } = fixture;
        const { appAddress } = await appClient.appClient.getAppReference();
        const payTxn = await fixture.algorand.transactions.payment({
            sender: admin,
            receiver: appAddress,
            amount: algokit.algos(10000),
        });

        await appClient.addRewardsAlgo({ payTxn, quantity: algokit.algos(10000).microAlgos });
        const rewardAssetBalance = (await algorand.account.getInformation(appAddress)).amount;
        expect(rewardAssetBalance).toBe(algokit.algos(10001).microAlgos);
        const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
        const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
        const contractDuration = (await appClient.getGlobalState()).contractDuration!.asBigInt();
        expect(totalRewards).toBe(BigInt(algokit.algos(10000).microAlgos));
        console.log('rewardsAvailablePerTick', rewardsAvailablePerTick); //3858n
    });

    test('set Prices', async () => {

        await appClient.setPrices({
            stakeTokenPrice: 1000000n,
            rewardTokenPrice: 150000n,
        });
        const stakedTokenPrice = (await appClient.getGlobalState()).stakeTokenPrice!.asBigInt();
        const rewardTokenPrice = (await appClient.getGlobalState()).rewardTokenPrice!.asBigInt();
        expect(stakedTokenPrice).toBe(1000000n);
        expect(rewardTokenPrice).toBe(150000n);
    });

    test('creating accounts and opting in, prep for staking', async () => {
        const { algorand } = fixture;
        stakingAccount = await fixture.context.generateAccount({ initialFunds: algokit.algos(10) });
        await appClient.optIn.optInToApplication({}, { sender: stakingAccount });
        await algorand.send.assetTransfer({
            assetId: stakedAssetId,
            amount: 0n,
            sender: stakingAccount.addr,
            receiver: stakingAccount.addr,
        });
        await algorand.send.assetTransfer({
            assetId: stakedAssetId,
            amount: 50_000_000_000n,
            sender: admin,
            receiver: stakingAccount.addr,
        });
    });

    async function accrueAll() {

        console.log('staker:', stakingAccount.addr)
        await appClient.accrueRewards({ userAddress: stakingAccount.addr }, { sender: stakingAccount, sendParams: { fee: algokit.algos(0.1) } });
        const userAccruedRewards = (await appClient.getLocalState(stakingAccount.addr)).accruedRewards!.asBigInt();
        console.log('userAccruedRewards', userAccruedRewards);

    }

    test('stake', async () => {
        const { algorand } = fixture;
        const stakingAmount = 50_000_000_000n;
        const lockPeriod = 2588000n;
        const staker = stakingAccount;

        const stakedAssetBalanceBefore = (await algorand.account.getAssetInformation(staker.addr, stakedAssetId)).balance;
        const rewardAssetBalanceBefore = BigInt((await algorand.account.getInformation(staker.addr)).amount);
        const { appAddress } = await appClient.appClient.getAppReference();

        const stakeTxn = await algorand.transactions.assetTransfer({
            assetId: stakedAssetId,
            amount: stakingAmount,
            sender: staker.addr,
            receiver: appAddress,
        });
        await appClient.stake({ lockPeriod: lockPeriod, quantity: stakingAmount, stakeTxn }, { sender: staker, sendParams: { fee: algokit.algos(0.2) } });

        const stakedAssetBalanceAfter = (await algorand.account.getAssetInformation(staker.addr, stakedAssetId)).balance;
        const rewardAssetBalanceAfter = BigInt((await algorand.account.getInformation(staker.addr)).amount);
        const rewardRate = (await appClient.getLocalState(staker.addr)).rewardRate!.asBigInt();

        expect(stakedAssetBalanceBefore).toBe(stakingAmount);
        expect(stakedAssetBalanceAfter).toBe(0n);
        expect(rewardAssetBalanceBefore).toBe(9998000n);
        expect(rewardAssetBalanceAfter).toBe(9797000n);

        const totalStakingWeight = (await appClient.getGlobalState()).totalStakingWeight!.asBigInt();
        const stakeTokenPrice = 1000000n;
        const rewardTokenPrice = 150000n;
        const normalisedAmount = ((stakingAmount * stakeTokenPrice) / rewardTokenPrice);
        const userStakingWeight = (normalisedAmount * lockPeriod);
        expect(totalStakingWeight).toBeGreaterThanOrEqual(userStakingWeight);
        const rewardsAvailablePerTick = (await appClient.getGlobalState()).rewardsAvailablePerTick!.asBigInt();
        const userRewardRate = (await appClient.getLocalState(staker.addr)).rewardRate!.asBigInt();
        expect(userRewardRate).toBe(rewardsAvailablePerTick);

    });

    async function waitForDuration(duration: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, duration);
        });
    }
    test('accrue reward 1', async () => {
        await waitForDuration(5000);
        accrueAll();
        await waitForDuration(5000);
        accrueAll();
    });


    test('admin Unstake', async () => {
        const { algorand } = fixture;
        let totalPaidOut = 0n;
        const staker = stakingAccount;
        const rewardBalancePrior = BigInt((await algorand.account.getInformation(staker.addr)).amount);
        await appClient.adminUnstake({ userAddress: staker.addr }, { sendParams: { fee: algokit.algos(0.02) } });
        //get asset balances
        const stakedAssetBalance = (await algorand.account.getAssetInformation(staker.addr, stakedAssetId)).balance;
        const rewardAssetBalance = BigInt((await algorand.account.getInformation(staker.addr)).amount);
        console.log('stakedAssetBalance', stakedAssetBalance);
        console.log('rewardAssetBalance', rewardAssetBalance);
        totalPaidOut += (rewardAssetBalance - rewardBalancePrior);

        const remainingRewards = (await appClient.getGlobalState()).remainingRewards!.asBigInt();
        const totalRewards = (await appClient.getGlobalState()).totalRewards!.asBigInt();
        console.log('remainingRewards', remainingRewards);
        console.log('totalRewards', totalRewards);
        console.log('rewards spent', totalRewards - remainingRewards);
        console.log('totalPaidOut', totalPaidOut);
    });

    test('delete app - non-admin', async () => {
        const { algorand } = fixture;
        const staker = stakingAccount;
        await expect(
            appClient.delete.deleteApplication(
                {
                },
                {
                    sender: staker,
                    sendParams: { fee: algokit.algos(0.2) },
                },
            ),
        ).rejects.toThrowError();
    });

    test('delete app', async () => {
        await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
    });
});
