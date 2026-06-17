import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { compile } from '@ton/blueprint';
import '@ton/test-utils';
import { JettonWallet } from '../wrappers/JettonWallet';
import { jettonContentToCell, JettonMinter } from '../wrappers/JettonMinter';
import { Op, Errors } from '../wrappers/JettonConstants';

describe('ZKGRM wallet policy', () => {
    let blockchain: Blockchain;
    let admin: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let recipient: SandboxContract<TreasuryContract>;
    let protocolOwner: SandboxContract<TreasuryContract>;
    let jettonMinter: SandboxContract<JettonMinter>;
    let userWallet: SandboxContract<JettonWallet>;
    let recipientWallet: SandboxContract<JettonWallet>;
    let protocolWallet: SandboxContract<JettonWallet>;
    let minterCode: Cell;
    let walletCode: Cell;

    beforeAll(async () => {
        minterCode = await compile('JettonMinter');
        walletCode = await compile('JettonWallet');
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        admin = await blockchain.treasury('admin');
        user = await blockchain.treasury('user');
        recipient = await blockchain.treasury('recipient');
        protocolOwner = await blockchain.treasury('protocolOwner');

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

        userWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(user.address)),
        );
        recipientWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(recipient.address)),
        );
        protocolWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(protocolOwner.address)),
        );

        await jettonMinter.sendMint(admin.getSender(), user.address, 1000n, admin.address, admin.address, null, 0n, toNano('0.5'));
        await jettonMinter.sendMint(admin.getSender(), recipient.address, 1n, admin.address, admin.address, null, 0n, toNano('0.5'));
        await jettonMinter.sendMint(admin.getSender(), protocolOwner.address, 1000n, admin.address, admin.address, null, 0n, toNano('0.5'));

        expect(await userWallet.getJettonBalance()).toEqual(1000n);
        expect(await recipientWallet.getJettonBalance()).toEqual(1n);
        expect(await protocolWallet.getJettonBalance()).toEqual(1000n);
    });

    it('soft-rejects default user outgoing transfers with a text note and keeps balance', async () => {
        const userBalanceBefore = await userWallet.getJettonBalance();
        const recipientBalanceBefore = await recipientWallet.getJettonBalance();

        const result = await userWallet.sendTransfer(
            user.getSender(),
            toNano('0.2'),
            10n,
            recipient.address,
            user.address,
            null,
            0n,
            null,
        );

        expect(result.transactions).toHaveTransaction({
            from: user.address,
            to: userWallet.address,
            op: Op.transfer,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: userWallet.address,
            to: user.address,
            op: 0,
            success: true,
        });
        expect(result.transactions).not.toHaveTransaction({
            from: userWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
        });
        expect(await userWallet.getJettonBalance()).toEqual(userBalanceBefore);
        expect(await recipientWallet.getJettonBalance()).toEqual(recipientBalanceBefore);
    });

    it('allows protocol wallets to transfer with standard TEP-74 flow', async () => {
        await jettonMinter.sendLockWallet(admin.getSender(), protocolOwner.address, 'protocol');

        const result = await protocolWallet.sendTransfer(
            protocolOwner.getSender(),
            toNano('0.2'),
            10n,
            recipient.address,
            protocolOwner.address,
            null,
            0n,
            null,
        );

        expect(result.transactions).toHaveTransaction({
            from: protocolWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(await protocolWallet.getJettonBalance()).toEqual(990n);
        expect(await recipientWallet.getJettonBalance()).toEqual(11n);
    });

    it('soft-rejects plain transfers to protocol wallets by default', async () => {
        await jettonMinter.sendLockWallet(admin.getSender(), protocolOwner.address, 'protocol');

        const result = await userWallet.sendTransfer(
            user.getSender(),
            toNano('0.2'),
            10n,
            protocolOwner.address,
            user.address,
            null,
            0n,
            null,
        );

        expect(result.transactions).toHaveTransaction({
            from: userWallet.address,
            to: user.address,
            op: 0,
            success: true,
        });
        expect(result.transactions).not.toHaveTransaction({
            from: userWallet.address,
            to: protocolWallet.address,
            op: Op.internal_transfer,
        });
        expect(await userWallet.getJettonBalance()).toEqual(1000n);
        expect(await protocolWallet.getJettonBalance()).toEqual(1000n);
    });

    it('allows default user transfers with contract payload to protocol wallets', async () => {
        await jettonMinter.sendLockWallet(admin.getSender(), protocolOwner.address, 'protocol');

        const contractPayload = beginCell().storeUint(0xdeadbeef, 32).endCell();
        const result = await userWallet.sendTransfer(
            user.getSender(),
            toNano('0.25'),
            10n,
            protocolOwner.address,
            user.address,
            null,
            toNano('0.05'),
            contractPayload,
        );

        expect(result.transactions).toHaveTransaction({
            from: userWallet.address,
            to: protocolWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: protocolWallet.address,
            to: protocolOwner.address,
            op: Op.transfer_notification,
            success: true,
        });
        expect(await userWallet.getJettonBalance()).toEqual(990n);
        expect(await protocolWallet.getJettonBalance()).toEqual(1010n);
    });

    it('deploys an uninitialized protocol wallet before the first pool deposit', async () => {
        const freshPool = await blockchain.treasury('freshPool');
        const freshPoolWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(freshPool.address)),
        );

        expect(await freshPoolWallet.getWalletStatus()).toEqual(0);

        await jettonMinter.sendLockWallet(admin.getSender(), freshPool.address, 'protocol');
        expect(await freshPoolWallet.getWalletStatus()).toEqual(4);

        const contractPayload = beginCell().storeUint(0xdeadbeef, 32).endCell();
        const result = await userWallet.sendTransfer(
            user.getSender(),
            toNano('0.25'),
            10n,
            freshPool.address,
            user.address,
            null,
            toNano('0.05'),
            contractPayload,
        );

        expect(result.transactions).toHaveTransaction({
            from: userWallet.address,
            to: freshPoolWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: freshPoolWallet.address,
            to: freshPool.address,
            op: Op.transfer_notification,
            success: true,
        });
        expect(await freshPoolWallet.getJettonBalance()).toEqual(10n);
    });

    it('deploys an uninitialized protocol wallet from set_status value without pre-funded minter balance', async () => {
        const lowBalanceMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: admin.address,
                    wallet_code: walletCode,
                    jetton_content: jettonContentToCell({ uri: 'https://zkgrm.example/meta.json' }),
                },
                minterCode,
            ),
        );
        const freshPool = await blockchain.treasury('freshPoolLowBalance');
        const freshPoolWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await lowBalanceMinter.getWalletAddress(freshPool.address)),
        );

        await lowBalanceMinter.sendDeploy(admin.getSender(), toNano('0.05'));
        await lowBalanceMinter.sendLockWallet(admin.getSender(), freshPool.address, 'protocol');

        expect(await freshPoolWallet.getWalletStatus()).toEqual(4);
    });

    it('handles pool withdraw to regular user wallets without forward notification', async () => {
        await jettonMinter.sendLockWallet(admin.getSender(), protocolOwner.address, 'protocol');

        const result = await protocolWallet.sendTransfer(
            protocolOwner.getSender(),
            toNano('0.2'),
            10n,
            recipient.address,
            protocolOwner.address,
            null,
            0n,
            null,
        );

        expect(result.transactions).toHaveTransaction({
            from: protocolWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(result.transactions).not.toHaveTransaction({
            from: recipientWallet.address,
            to: recipient.address,
            op: Op.transfer_notification,
        });
        expect(await protocolWallet.getJettonBalance()).toEqual(990n);
        expect(await recipientWallet.getJettonBalance()).toEqual(11n);
    });

    it('documents that pool withdraw with forward notification still bounces for regular user wallets', async () => {
        await jettonMinter.sendLockWallet(admin.getSender(), protocolOwner.address, 'protocol');
        const payload = beginCell().storeUint(0xdeadbeef, 32).endCell();

        const result = await protocolWallet.sendTransfer(
            protocolOwner.getSender(),
            toNano('0.25'),
            10n,
            recipient.address,
            protocolOwner.address,
            null,
            toNano('0.05'),
            payload,
        );

        expect(result.transactions).toHaveTransaction({
            from: protocolWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
            success: false,
            exitCode: Errors.contract_locked,
        });
        expect(await protocolWallet.getJettonBalance()).toEqual(1000n);
        expect(await recipientWallet.getJettonBalance()).toEqual(1n);
    });

    it('blocks default user transfers with text comment payload', async () => {
        const notePayload = beginCell().storeUint(0, 32).storeStringTail('hello').endCell();
        const result = await userWallet.sendTransfer(
            user.getSender(),
            toNano('0.2'),
            10n,
            recipient.address,
            user.address,
            null,
            toNano('0.05'),
            notePayload,
        );

        expect(result.transactions).toHaveTransaction({
            from: userWallet.address,
            to: user.address,
            op: 0,
            success: true,
        });
        expect(result.transactions).not.toHaveTransaction({
            from: userWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
        });
        expect(await userWallet.getJettonBalance()).toEqual(1000n);
        expect(await recipientWallet.getJettonBalance()).toEqual(1n);
    });

    it('bounces default user contract-payload transfers to regular user wallets', async () => {
        const contractPayload = beginCell().storeUint(0xdeadbeef, 32).endCell();
        const result = await userWallet.sendTransfer(
            user.getSender(),
            toNano('0.25'),
            10n,
            recipient.address,
            user.address,
            null,
            toNano('0.05'),
            contractPayload,
        );

        expect(result.transactions).toHaveTransaction({
            from: userWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
            success: false,
            exitCode: Errors.contract_locked,
        });
        expect(result.transactions).toHaveTransaction({
            from: recipientWallet.address,
            to: userWallet.address,
            op: 0xffffffff,
            success: true,
        });
        expect(await userWallet.getJettonBalance()).toEqual(1000n);
        expect(await recipientWallet.getJettonBalance()).toEqual(1n);
    });

    it('accepts plain incoming transfers to default user wallets', async () => {
        await jettonMinter.sendLockWallet(admin.getSender(), protocolOwner.address, 'protocol');

        const result = await protocolWallet.sendTransfer(
            protocolOwner.getSender(),
            toNano('0.2'),
            10n,
            recipient.address,
            protocolOwner.address,
            null,
            0n,
            null,
        );

        expect(result.transactions).toHaveTransaction({
            from: protocolWallet.address,
            to: recipientWallet.address,
            op: Op.internal_transfer,
            success: true,
        });
        expect(await recipientWallet.getJettonBalance()).toEqual(11n);
    });

});
