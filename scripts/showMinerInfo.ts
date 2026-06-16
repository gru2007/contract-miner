import { fromNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { Miner } from '../wrappers/Miner';
import { promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { compactAddress, formatTargetBits, getContractBalance } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const minerAddress = await promptUserFriendlyAddress('Enter Miner address', ui, isTestnet);
    const miner = provider.open(Miner.createFromAddress(minerAddress.address));

    if (!(await provider.isContractDeployed(minerAddress.address))) {
        ui.write('Miner is not deployed');
        return;
    }

    const balance = await getContractBalance(provider, minerAddress.address);
    ui.write(`Miner address: ${compactAddress(minerAddress.address, isTestnet)}`);
    ui.write(`TON balance: ${fromNano(balance)} TON`);

    try {
        const data = await miner.getMinerData();
        ui.write(`Owner: ${compactAddress(data.ownerAddress, isTestnet)}`);
        ui.write(`Jetton wallet: ${compactAddress(data.jettonWalletAddress, isTestnet)}`);
        ui.write(`Seed: ${data.seed.toString()}`);
        ui.write(`PoW complexity: ${data.powComplexity.toString()} (${formatTargetBits(data.powComplexity)})`);
        ui.write(`Last success: ${data.lastSuccess.toString()}`);
        ui.write(`Target delta: ${data.targetDelta.toString()} sec`);
        ui.write(`min_cpl/max_cpl: ${data.minCpl.toString()} / ${data.maxCpl.toString()}`);
        ui.write(`Reward amount: ${data.rewardAmount.toString()} base units`);
    } catch (e: any) {
        ui.write(`get_miner_data failed: ${e.message ?? e}`);
        const pow = await miner.getPowParams();
        ui.write(`Seed: ${pow.seed.toString()}`);
        ui.write(`PoW complexity: ${pow.powComplexity.toString()} (${formatTargetBits(pow.powComplexity)})`);
        ui.write(`Reward amount: ${pow.amount.toString()} base units`);
        ui.write(`Target delta: ${pow.targetDelta.toString()} sec`);
    }
}
