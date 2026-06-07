import { fromNano, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { Miner, Opcodes } from '../wrappers/Miner';
import { addressToString, promptBool, promptToncoin, promptUserFriendlyAddress } from '../wrappers/ui-utils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const minerAddress = await promptUserFriendlyAddress('Enter Miner address', ui, isTestnet);
    const address = minerAddress.address;

    if (!(await provider.isContractDeployed(address))) {
        ui.write(`Error: Contract at address ${address} is not deployed!`);
        return;
    }

    const miner = provider.open(Miner.createFromAddress(address));
    const balance = await miner.getTonBalance();

    ui.write(`Miner TON balance: ${fromNano(balance)} TON`);

    const recipientAddress = await promptUserFriendlyAddress('Enter recipient address', ui, isTestnet);
    const amount = await promptToncoin('Enter TON amount to withdraw', ui);
    const gasValue = await promptToncoin('Enter TON amount to attach for gas', ui);
    const queryId = BigInt(Date.now());

    if (amount + gasValue > balance) {
        ui.write(`Miner balance is not enough: ${fromNano(balance)} TON`);
        return;
    }

    if (!(await promptBool(
        `Withdraw ${fromNano(amount)} TON from ${addressToString(minerAddress)} to ${addressToString(recipientAddress)}?`,
        ['yes', 'no'],
        ui,
    ))) {
        return;
    }

    await miner.sendWithdrawTon(provider.sender(), recipientAddress.address, amount, gasValue, queryId);

    ui.write('Transaction sent');
    ui.write(`Opcode: ${Opcodes.withdraw_ton}`);
    ui.write(`Query id: ${queryId}`);
    ui.write(`Attached value: ${fromNano(gasValue)} TON`);
}
