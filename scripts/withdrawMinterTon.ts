import { fromNano, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { Op } from '../wrappers/JettonConstants';
import { JettonMinter } from '../wrappers/JettonMinter';
import { addressToString, promptBool, promptToncoin, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { getContractBalance } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const minterAddress = await promptUserFriendlyAddress('Enter JettonMinter address', ui, isTestnet);

    if (!(await provider.isContractDeployed(minterAddress.address))) {
        ui.write(`Error: Contract at address ${addressToString(minterAddress)} is not deployed!`);
        return;
    }

    const minter = provider.open(JettonMinter.createFromAddress(minterAddress.address));
    const balance = await getContractBalance(provider, minterAddress.address);

    ui.write(`JettonMinter TON balance: ${fromNano(balance)} TON`);
    ui.write('Only the minter admin can withdraw TON. / Вывести TON может только admin минтера.');

    const recipientAddress = await promptUserFriendlyAddress('Enter recipient address', ui, isTestnet);
    const amount = await promptToncoin('Enter TON amount to withdraw', ui);
    const gasValue = toNano('0.05');
    const queryId = BigInt(Date.now());

    if (amount + gasValue > balance) {
        ui.write(`Minter balance is not enough: ${fromNano(balance)} TON`);
        return;
    }

    if (!(await promptBool(
        `Withdraw ${fromNano(amount)} TON from ${addressToString(minterAddress)} to ${addressToString(recipientAddress)}?`,
        ['yes', 'no'],
        ui,
    ))) {
        return;
    }

    await minter.sendWithdrawTon(provider.sender(), recipientAddress.address, amount, gasValue, queryId);

    ui.write('Transaction sent');
    ui.write(`Opcode: ${Op.withdraw_ton}`);
    ui.write(`Query id: ${queryId}`);
    ui.write(`Attached value: ${fromNano(gasValue)} TON`);
}
