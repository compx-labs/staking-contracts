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
const PRECISION = 1_000_000_000n;
const stakeTokenPrice = 1000000n;
const rewardTokenPrice = 150000n;
let stakingAccount: TransactionSignerAccount;


describe('CompXStaking ASA/Algo - single staker', () => {
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
            adminAddress: admin,
        });
    });

    test('confirm global state on initialisation', async () => {
        const globalState = await appClient.getGlobalState();
        expect(globalState.stakedAssetId!.asBigInt()).toBe(stakedAssetId);
        expect(globalState.rewardAssetId!.asBigInt()).toBe(rewardAssetId);
        expect(globalState.minLockUp!.asBigInt()).toBe(10n);
        expect(globalState.contractDuration!.asBigInt()).toBe(2592000n);
        expect(globalState.rewardsAvailablePerTick!.asBigInt()).toBe(0n);
        expect(globalState.totalStakingWeight!.asBigInt()).toBe(0n);
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
        expect(rewardsAvailablePerTick).toBe(BigInt(totalRewards / contractDuration));
        console.log('rewardsAvailablePerTick', rewardsAvailablePerTick); //3858n
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


    test('stake', async () => {
        const { algorand } = fixture;
        const stakingAmount = 50_000_000_000n;
        const lockPeriod = 2588000n;
        const staker = stakingAccount;
        const { appAddress } = await appClient.appClient.getAppReference();

        const stakeTxn = await algorand.transactions.assetTransfer({
            assetId: stakedAssetId,
            amount: stakingAmount,
            sender: staker.addr,
            receiver: appAddress,
        });

        const globalState = await appClient.getGlobalState();
        const normalisedAmount = (((stakingAmount * stakeTokenPrice)) / rewardTokenPrice);
        const userStakingWeight = (normalisedAmount * lockPeriod);
        let totalStakingWeight = globalState.totalStakingWeight!.asBigInt();
        totalStakingWeight += userStakingWeight;
        const userShare = (userStakingWeight / totalStakingWeight) * 100n;
        const rewardsAvailablePerTick = globalState.rewardsAvailablePerTick!.asBigInt();
        const rewardRate = Math.floor(Number(rewardsAvailablePerTick * userShare / 100n));
        console.log('<stake> normalisedAmount, userStakingWeight, totalStakingWeight, userShare, rewardsAvailablePerTick, rewardRate', normalisedAmount, userStakingWeight, totalStakingWeight, userShare, rewardsAvailablePerTick, rewardRate);

        await appClient.stake({ lockPeriod: lockPeriod, quantity: stakingAmount, stakeTxn, userRewardRate: rewardRate, userStakingWeight: userStakingWeight }, { sender: staker, sendParams: { fee: algokit.algos(0.2) } });

        const localState = await appClient.getLocalState(staker.addr);
        const stakedAmount = localState.staked!.asBigInt();
        const rewardRateLocal = localState.rewardRate!.asBigInt();
        const userStakingWeightLocal = localState.userStakingWeight!.asBigInt();
        const accruedRewards = localState.accruedRewards!.asBigInt();
        console.log('<stake> stakedAmount, rewardRateLocal, userStakingWeightLocal, accruedRewards', stakedAmount, rewardRateLocal, userStakingWeightLocal, accruedRewards);
    });

    const calculateRewards = async () => {
        const staker = stakingAccount;
        const globalState = await appClient.getGlobalState();
        const localState = await appClient.getLocalState(staker.addr);
        const stakingAmount = localState.staked!.asBigInt();
        const lockPeriod = localState.stakeDuration!.asBigInt();

        const normalisedAmount = (((stakingAmount * stakeTokenPrice)) / rewardTokenPrice);
        const userStakingWeight = (normalisedAmount * lockPeriod);
        let totalStakingWeight = globalState.totalStakingWeight!.asBigInt();
        totalStakingWeight += userStakingWeight;
        const userShare = (userStakingWeight / totalStakingWeight) * 100n;
        const rewardsAvailablePerTick = globalState.rewardsAvailablePerTick!.asBigInt();
        const rewardRate = Math.floor(Number(rewardsAvailablePerTick * userShare / 100n));
        console.log('<calculateRewards> normalisedAmount, userStakingWeight, totalStakingWeight, userShare, rewardsAvailablePerTick, rewardRate', normalisedAmount, userStakingWeight, totalStakingWeight, userShare, rewardsAvailablePerTick, rewardRate);
        await appClient.setRewardRate({ userAddress: staker.addr, userStakingWeight: userStakingWeight, userRewardRate: rewardRate }, { sendParams: { fee: algokit.algos(0.1) } });
    }

    const accrueAll = async () => {
        const staker = stakingAccount;
        calculateRewards();

        await appClient.accrueRewards({ userAddress: staker.addr }, { sendParams: { fee: algokit.algos(0.1) } });
        const localState = await appClient.getLocalState(staker.addr);
        const stakedAmount = localState.staked!.asBigInt();
        const rewardRateLocal = localState.rewardRate!.asBigInt();
        const userStakingWeightLocal = localState.userStakingWeight!.asBigInt();
        const accruedRewards = localState.accruedRewards!.asBigInt();
        console.log('<accrueAll> stakedAmount, rewardRateLocal, userStakingWeightLocal, accruedRewards', stakedAmount, rewardRateLocal, userStakingWeightLocal, accruedRewards);

    }

    async function waitForDuration(duration: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, duration);
        });
    }
    test('accrue reward ', async () => {
        await waitForDuration(5000);
        accrueAll();
        await waitForDuration(5000);
        accrueAll();
    });


    test.skip('unstake', async () => {
        const { algorand } = fixture;
        let totalPaidOut = 0n;
        const staker = stakingAccount;
        const rewardBalancePrior = BigInt((await algorand.account.getInformation(staker.addr)).amount);
        await appClient.unstake({}, { sender: staker, sendParams: { fee: algokit.algos(0.02) } });
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

    test('delete app', async () => {
        await appClient.delete.deleteApplication({}, { sendParams: { fee: algokit.algos(0.2) } });
    });
});
