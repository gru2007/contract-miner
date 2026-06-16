import { toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { createGrmGiverConfigs, GRM_GIVER_PRESETS, Miner } from '../wrappers/Miner';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { nowUnix, promptPositiveBigInt } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const owner = await promptUserFriendlyAddress('Enter owner/admin address for all GRM givers', ui, isTestnet);
    const deployValue = await promptPositiveBigInt('Enter TON deploy value per giver in nanotons', ui, toNano('0.05'));

    ui.write('GRM giver presets:');
    for (const [name, preset] of Object.entries(GRM_GIVER_PRESETS)) {
        ui.write(`${name}: count=${preset.count}, reward=${preset.amount.toString()}, interval=${preset.interval.toString()}, complexity=${preset.pow_complexity.toString()}`);
    }

    const code = await compile('Miner');
    const configs = createGrmGiverConfigs(owner.address, nowUnix(), { jwall_addr: null });
    const givers = Miner.createGiversFromConfigs(configs, code).map((giver) => provider.open(giver));

    ui.write(`Prepared ${givers.length} giver contracts.`);
    givers.forEach((giver, i) => ui.write(`${i + 1}. ${giver.address.toString({ testOnly: isTestnet })}`));

    if (!(await promptBool(`Deploy all ${givers.length} givers?`, ['yes', 'no'], ui))) {
        return;
    }

    for (let i = 0; i < givers.length; i++) {
        ui.write(`Deploying ${i + 1}/${givers.length}: ${givers[i].address.toString({ testOnly: isTestnet })}`);
        await givers[i].sendDeploy(provider.sender(), deployValue);
        await provider.waitForDeploy(givers[i].address);
    }

    ui.write('All giver deploy transactions sent and deploy confirmations completed.');
}
