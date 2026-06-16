import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const minterAddress = await promptUserFriendlyAddress('Enter ZKGRM jetton minter address', ui, isTestnet);
    const minerAddress = await promptUserFriendlyAddress('Enter Miner/giver contract address', ui, isTestnet);
    const enabled = await promptBool('Enable this contract as PoW minter?', ['yes', 'no'], ui, true);
    const cap = enabled ? await provider.ui().input('Enter total emission cap in jetton base units') : '0';

    const minter = provider.open(JettonMinter.createFromAddress(minterAddress.address));
    await minter.sendSetPowMinter(provider.sender(), minerAddress.address, enabled, BigInt(cap.trim() || '0'), toNano('0.05'));

    ui.write(`${enabled ? 'Enable' : 'Disable'} PoW minter transaction sent`);
}
