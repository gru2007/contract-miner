import { toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { createGrmGiverConfigs, GRM_GIVER_PRESETS, Miner } from '../wrappers/Miner';
import { JettonMinter } from '../wrappers/JettonMinter';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { nowUnix, promptPositiveBigInt } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const owner = await promptUserFriendlyAddress('Enter owner/admin address for all GRM givers', ui, isTestnet);
    const minterAddress = await promptUserFriendlyAddress('Enter ZKGRM jetton minter address', ui, isTestnet);
    const deployValue = await promptPositiveBigInt('Enter TON deploy value per giver in nanotons', ui, toNano('0.05'));

    ui.write('GRM giver presets:');
    for (const [name, preset] of Object.entries(GRM_GIVER_PRESETS)) {
        ui.write(`${name}: count=${preset.count}, reward=${preset.amount.toString()}, interval=${preset.interval.toString()}, complexity=${preset.pow_complexity.toString()}`);
    }

    const code = await compile('Miner');
    const configs = createGrmGiverConfigs(owner.address, nowUnix(), { jetton_minter_addr: minterAddress.address });
    const givers = Miner.createGiversFromConfigs(configs, code).map((giver) => provider.open(giver));
    const minter = provider.open(JettonMinter.createFromAddress(minterAddress.address));

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

    if (await promptBool(`Allowlist all ${givers.length} givers in the ZKGRM minter now? Sender must be minter admin.`, ['yes', 'no'], ui)) {
        const capMultiplier = await promptPositiveBigInt('Enter cap multiplier per giver: cap = reward_amount * multiplier', ui, 1_000_000n);
        for (let i = 0; i < givers.length; i++) {
            ui.write(`Allowlisting ${i + 1}/${givers.length}: ${givers[i].address.toString({ testOnly: isTestnet })}`);
            await minter.sendSetPowMinter(provider.sender(), givers[i].address, true, BigInt(configs[i].reward_amount ?? 0) * capMultiplier);
        }
    }

    ui.write('All giver deploy transactions completed. No reward pre-funding is needed with mint-on-mine.');
    ui.write('ZKGRM_GIVERS for miners:');
    ui.write(givers.map((giver, i) => `${giver.address.toString({ testOnly: isTestnet })}:${configs[i].reward_amount?.toString()}`).join(','));
}
