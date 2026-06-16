import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, SendMode, toNano } from '@ton/core';
import { createGrmGiverConfigs, Miner } from '../wrappers/Miner';
import { JettonWallet } from '../wrappers/JettonWallet';
import { jettonContentToCell, JettonMinter } from '../wrappers/JettonMinter';
import { Op } from '../wrappers/JettonConstants';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

function hashToBigInt(cell: Cell) {
    return BigInt('0x' + cell.hash().toString('hex'));
}

function findMineParams(seed: bigint, complexity: bigint, expire: bigint, recipient?: SandboxContract<TreasuryContract>) {
    for (let i = 0n; i < 10000n; i++) {
        const body = Miner.mineMessage({ expire, rdata: i, rseed: seed });
        if (hashToBigInt(body) < complexity) {
            return { expire, rdata: i, rseed: seed, recipient: recipient?.address };
        }
    }
    throw new Error('failed to find test PoW body');
}

describe('Miner', () => {
    let minerCode: Cell;
    let minterCode: Cell;
    let walletCode: Cell;

    beforeAll(async () => {
        minerCode = await compile('Miner');
        minterCode = await compile('JettonMinter');
        walletCode = await compile('JettonWallet');
    });

    let blockchain: Blockchain;
    let admin: SandboxContract<TreasuryContract>;
    let minerUser: SandboxContract<TreasuryContract>;
    let rewardRecipient: SandboxContract<TreasuryContract>;
    let miner: SandboxContract<Miner>;
    let jettonMinter: SandboxContract<JettonMinter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = Math.floor(Date.now() / 1000);

        admin = await blockchain.treasury('admin');
        minerUser = await blockchain.treasury('minerUser');
        rewardRecipient = await blockchain.treasury('rewardRecipient');

        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: admin.address,
                    wallet_code: walletCode,
                    jetton_content: jettonContentToCell({ uri: 'https://zkgrm.example/meta.json' }),
                },
                minterCode,
            ),
        );
        await jettonMinter.sendDeploy(admin.getSender(), toNano('5'));

        miner = blockchain.openContract(
            Miner.createFromConfig(
                {
                    owner_addr: admin.address,
                    jwall_addr: null,
                    seed: 123n,
                    pow_complexity: (1n << 256n) - 1n,
                    last_success: BigInt(blockchain.now),
                    target_delta: 60n,
                    min_cpl: 1n,
                    max_cpl: 255n,
                },
                minerCode,
            ),
        );

        const deployResult = await miner.sendDeploy(admin.getSender(), toNano('0.1'));
        expect(deployResult.transactions).toHaveTransaction({
            from: admin.address,
            to: miner.address,
            deploy: true,
            success: true,
        });
    });

    it('auto-detects its jetton wallet from transfer_notification', async () => {
        const expectedMinerJettonWallet = await jettonMinter.getWalletAddress(miner.address);
        expect(await miner.getJettonWalletAddress()).toBeNull();

        const mintResult = await jettonMinter.sendMint(
            admin.getSender(),
            miner.address,
            1_000_000_000n,
            admin.address,
            admin.address,
            null,
            toNano('0.05'),
            toNano('0.5'),
        );

        expect(mintResult.transactions).toHaveTransaction({
            from: expectedMinerJettonWallet,
            to: miner.address,
            op: Op.transfer_notification,
            success: true,
        });
        expect(await miner.getJettonWalletAddress()).toEqualAddress(expectedMinerJettonWallet);
    });

    it('mines PoW reward from protocol miner wallet to user wallet', async () => {
        const minerJettonWalletAddress = await jettonMinter.getWalletAddress(miner.address);
        const userJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(minerUser.address)),
        );

        await jettonMinter.sendMint(
            admin.getSender(),
            miner.address,
            1_000_000_000n,
            admin.address,
            admin.address,
            null,
            toNano('0.05'),
            toNano('0.5'),
        );
        expect(await miner.getJettonWalletAddress()).toEqualAddress(minerJettonWalletAddress);

        await jettonMinter.sendLockWallet(admin.getSender(), miner.address, 'protocol');

        const pow = await miner.getPowParams();
        const mineResult = await miner.sendMine(minerUser.getSender(), toNano('0.25'), {
            expire: BigInt(blockchain.now! + 300),
            rdata: 777n,
            rseed: pow.seed,
        });

        expect(mineResult.transactions).toHaveTransaction({
            from: miner.address,
            to: minerJettonWalletAddress,
            op: Op.transfer,
            success: true,
        });
        expect(mineResult.transactions).toHaveTransaction({
            from: minerJettonWalletAddress,
            to: userJettonWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(await userJettonWallet.getJettonBalance()).toEqual(100_000_000n);
    });

    it('keeps legacy get_pow_params and exposes UI getters', async () => {
        const pow = await miner.getPowParams();
        const reward = await miner.getRewardAmount();
        const miningConfig = await miner.getMiningConfig();
        const minerData = await miner.getMinerData();

        expect(pow.amount).toEqual(100_000_000n);
        expect(reward).toEqual(100_000_000n);
        expect(miningConfig.seed).toEqual(pow.seed);
        expect(miningConfig.powComplexity).toEqual(pow.powComplexity);
        expect(miningConfig.rewardAmount).toEqual(reward);
        expect(minerData.ownerAddress).toEqualAddress(admin.address);
        expect(minerData.jettonWalletAddress).toBeNull();
        expect(minerData.targetDelta).toEqual(60n);
    });

    it('can mine to an explicit recipient without changing the legacy PoW hash prefix', async () => {
        const minerJettonWalletAddress = await jettonMinter.getWalletAddress(miner.address);
        const recipientJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(rewardRecipient.address)),
        );

        await jettonMinter.sendMint(admin.getSender(), miner.address, 1_000_000_000n, admin.address, admin.address, null, toNano('0.05'), toNano('0.5'));
        await jettonMinter.sendLockWallet(admin.getSender(), miner.address, 'protocol');

        const pow = await miner.getPowParams();
        const params = findMineParams(pow.seed, pow.powComplexity, BigInt(blockchain.now! + 300), rewardRecipient);
        const mineResult = await miner.sendMine(minerUser.getSender(), toNano('0.25'), params);

        expect(mineResult.transactions).toHaveTransaction({
            from: minerJettonWalletAddress,
            to: recipientJettonWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(await recipientJettonWallet.getJettonBalance()).toEqual(100_000_000n);
        expect(await blockchain.openContract(JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(minerUser.address))).getJettonBalance()).toEqual(0n);
    });

    it('saves new mining state before reward transfer when wallet policy blocks payout', async () => {
        await jettonMinter.sendMint(admin.getSender(), miner.address, 1_000_000_000n, admin.address, admin.address, null, toNano('0.05'), toNano('0.5'));

        const before = await miner.getMinerData();
        const params = findMineParams(before.seed, before.powComplexity, BigInt(blockchain.now! + 300));
        const mineResult = await miner.sendMine(minerUser.getSender(), toNano('0.25'), params);
        const after = await miner.getMinerData();

        expect(mineResult.transactions).toHaveTransaction({
            from: miner.address,
            to: await jettonMinter.getWalletAddress(miner.address),
            op: Op.transfer,
            success: true,
        });
        expect(after.seed).not.toEqual(before.seed);
        expect(after.lastSuccess).toEqual(BigInt(blockchain.now!));
        expect(await blockchain.openContract(JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(minerUser.address))).getJettonBalance()).toEqual(0n);
    });

    it('retargets difficulty faster for quick mines and respects lower bound', async () => {
        const fastMiner = blockchain.openContract(Miner.createFromConfig({
            owner_addr: admin.address,
            jwall_addr: null,
            seed: 321n,
            pow_complexity: (1n << 256n) - 1n,
            last_success: BigInt(blockchain.now! - 1),
            target_delta: 60n,
            min_cpl: 255n,
            max_cpl: 255n,
        }, minerCode));
        await fastMiner.sendDeploy(admin.getSender(), toNano('0.1'));
        await jettonMinter.sendMint(admin.getSender(), fastMiner.address, 1_000_000_000n, admin.address, admin.address, null, toNano('0.05'), toNano('0.5'));
        await jettonMinter.sendLockWallet(admin.getSender(), fastMiner.address, 'protocol');

        const before = await fastMiner.getMiningConfig();
        const params = findMineParams(before.seed, before.powComplexity, BigInt(blockchain.now! + 300));
        await fastMiner.sendMine(minerUser.getSender(), toNano('0.25'), params);
        const after = await fastMiner.getMiningConfig();

        expect(after.powComplexity).toEqual(1n << 255n);
    });

    it('retargets difficulty easier for slow mines and respects upper bound', async () => {
        const slowMiner = blockchain.openContract(Miner.createFromConfig({
            owner_addr: admin.address,
            jwall_addr: null,
            seed: 654n,
            pow_complexity: 1n << 254n,
            last_success: BigInt(blockchain.now! - 120),
            target_delta: 60n,
            min_cpl: 1n,
            max_cpl: 255n,
        }, minerCode));
        await slowMiner.sendDeploy(admin.getSender(), toNano('0.1'));
        await jettonMinter.sendMint(admin.getSender(), slowMiner.address, 1_000_000_000n, admin.address, admin.address, null, toNano('0.05'), toNano('0.5'));
        await jettonMinter.sendLockWallet(admin.getSender(), slowMiner.address, 'protocol');

        const before = await slowMiner.getMiningConfig();
        const params = findMineParams(before.seed, before.powComplexity, BigInt(blockchain.now! + 300));
        await slowMiner.sendMine(minerUser.getSender(), toNano('0.25'), params);
        const after = await slowMiner.getMiningConfig();

        expect(after.powComplexity).toBeGreaterThan(before.powComplexity);
        expect(after.powComplexity).toBeLessThanOrEqual(1n << 255n);
    });

    it('creates a GRM-style giver list and deploys it in one treasury batch', async () => {
        const configs = createGrmGiverConfigs(admin.address, BigInt(blockchain.now!), { min_cpl: 1n, max_cpl: 255n });
        const givers = Miner.createGiversFromConfigs(configs, minerCode);
        const messages = givers.slice(0, 8).map((giver) => Miner.createDeployMessage(giver, toNano('0.1')));

        await admin.sendMessages(messages, SendMode.PAY_GAS_SEPARATELY);

        for (const giver of givers.slice(0, 8)) {
            const opened = blockchain.openContract(giver);
            const data = await opened.getMinerData();
            expect(data.ownerAddress).toEqualAddress(admin.address);
        }
        expect(configs).toHaveLength(40);
        expect(configs[0].reward_amount).toEqual(100000000000n);
        expect(configs[10].reward_amount).toEqual(1000000000000n);
        expect(configs[20].reward_amount).toEqual(10000000000000n);
        expect(configs[30].reward_amount).toEqual(100000000000000n);
    });

    it('returns GRM-style get_pow_params with per-giver reward amount', async () => {
        const [config] = createGrmGiverConfigs(admin.address, BigInt(blockchain.now!), { min_cpl: 1n, max_cpl: 255n });
        const giver = blockchain.openContract(Miner.createFromConfig(config, minerCode));
        await giver.sendDeploy(admin.getSender(), toNano('0.1'));

        const pow = await giver.getPowParams();
        expect(pow.seed).toEqual(config.seed);
        expect(pow.powComplexity).toEqual(config.pow_complexity);
        expect(pow.amount).toEqual(100000000000n);
        expect(pow.targetDelta).toEqual(100n);
    });
});
