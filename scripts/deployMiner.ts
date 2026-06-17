import { toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { DEFAULT_REWARD_AMOUNT, Miner } from '../wrappers/Miner';
import { JettonMinter } from '../wrappers/JettonMinter';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { nowUnix, promptPositiveBigInt, promptUint } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const owner = await promptUserFriendlyAddress('Enter owner/admin address for Miner', ui, isTestnet);
    const minterAddress = await promptUserFriendlyAddress('Enter ZKGRM jetton minter address', ui, isTestnet);

    ui.write('Miner will mint rewards via this ZKGRM minter. The minter admin must allowlist the Miner as PoW minter.');
    ui.write('Mining modes / Режимы майнинга:');
    ui.write('Browser miner / Браузерный майнер: use easier difficulty, small reward, small cap. Good for regular users, but not GPU-proof.');
    ui.write('GPU miner / Майнер для видеокарты: use harder difficulty, bigger cap/reward, and expect browser users to lose often.');
    ui.write('Fair launch tip / Совет для честного запуска: deploy separate browser givers with low cap and low reward, then separate GPU givers.');
    ui.write('decimals=9 on the current minter metadata: 1 token = 1_000_000_000 base units. / decimals=9: 1 токен = 1_000_000_000 base units.');

    const seed = await promptUint('Enter initial seed uint128', ui, 128, 0x95b9ba60cd32d91a3255029230f8584fn);
    const powComplexity = await promptUint('Enter initial pow_complexity uint256; bigger = easier / больше = легче', ui, 256, 1n << 248n);
    const targetDelta = await promptPositiveBigInt('Enter target seconds between successful mines / целевые секунды между наградами', ui, 60n);
    const minCpl = await promptUint('Enter min_cpl uint8; hardest clamp exponent / самая сложная граница', ui, 8, 240n);
    const maxCpl = await promptUint('Enter max_cpl uint8; easiest clamp exponent / самая лёгкая граница', ui, 8, 252n);
    const rewardAmount = await promptPositiveBigInt('Enter reward_amount in jetton base units / награда в base units', ui, DEFAULT_REWARD_AMOUNT);
    const deployValue = await promptPositiveBigInt('Enter TON deploy value in nanotons', ui, toNano('0.05'));

    if (minCpl > maxCpl) {
        ui.write('min_cpl cannot be greater than max_cpl');
        return;
    }

    const code = await compile('Miner');
    const miner = provider.open(Miner.createFromConfig({
        owner_addr: owner.address,
        jetton_minter_addr: minterAddress.address,
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
    ui.write(`Target delta: ${targetDelta.toString()} sec, pow_complexity: ${powComplexity.toString()}, cpl clamp: ${minCpl.toString()}..${maxCpl.toString()}`);

    if (!(await promptBool('Deploy this Miner?', ['yes', 'no'], ui))) {
        return;
    }

    await miner.sendDeploy(provider.sender(), deployValue);
    await provider.waitForDeploy(miner.address);

    ui.write('Miner deployed');
    if (await promptBool('Allowlist this Miner in the ZKGRM minter now? Sender must be minter admin.', ['yes', 'no'], ui)) {
        const cap = await promptPositiveBigInt('Enter this Miner total emission cap in jetton base units', ui, rewardAmount * 1_000_000n);
        const minter = provider.open(JettonMinter.createFromAddress(minterAddress.address));
        await minter.sendSetPowMinter(provider.sender(), miner.address, true, cap);
        ui.write('PoW minter allowlist transaction sent');
    }
    ui.write('No reward wallet funding is needed: successful mining asks the minter to mint directly to the recipient.');
}
