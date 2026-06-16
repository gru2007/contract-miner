import { toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { DEFAULT_REWARD_AMOUNT, Miner } from '../wrappers/Miner';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { nowUnix, promptPositiveBigInt, promptUint } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const owner = await promptUserFriendlyAddress('Enter owner/admin address for Miner', ui, isTestnet);

    ui.write('jwall_addr will be stored as null. Miner will auto-detect its jetton wallet from the first transfer_notification.');

    const seed = await promptUint('Enter initial seed uint128', ui, 128, 0x95b9ba60cd32d91a3255029230f8584fn);
    const powComplexity = await promptUint('Enter initial pow_complexity uint256; bigger = easier', ui, 256, 1n << 248n);
    const targetDelta = await promptPositiveBigInt('Enter target seconds between successful mines', ui, 60n);
    const minCpl = await promptUint('Enter min_cpl uint8; hardest clamp exponent', ui, 8, 240n);
    const maxCpl = await promptUint('Enter max_cpl uint8; easiest clamp exponent', ui, 8, 252n);
    const rewardAmount = await promptPositiveBigInt('Enter reward_amount in jetton base units', ui, DEFAULT_REWARD_AMOUNT);
    const deployValue = await promptPositiveBigInt('Enter TON deploy value in nanotons', ui, toNano('0.05'));

    if (minCpl > maxCpl) {
        ui.write('min_cpl cannot be greater than max_cpl');
        return;
    }

    const code = await compile('Miner');
    const miner = provider.open(Miner.createFromConfig({
        owner_addr: owner.address,
        jwall_addr: null,
        seed,
        pow_complexity: powComplexity,
        last_success: nowUnix(),
        target_delta: targetDelta,
        min_cpl: minCpl,
        max_cpl: maxCpl,
        reward_amount: rewardAmount,
    }, code));

    ui.write(`Miner address: ${miner.address.toString({ testOnly: isTestnet })}`);
    ui.write(`Reward amount: ${rewardAmount.toString()} base units`);

    if (!(await promptBool('Deploy this Miner?', ['yes', 'no'], ui))) {
        return;
    }

    await miner.sendDeploy(provider.sender(), deployValue);
    await provider.waitForDeploy(miner.address);

    ui.write('Miner deployed');
    ui.write('Next: fund this Miner with ZKGRM via fundMinerRewards.ts, then set its jetton wallet status to protocol.');
}
