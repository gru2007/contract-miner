import { toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { Miner, minerConfigToCell } from '../wrappers/Miner';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { compactAddress, nowUnix, promptOptionalAddress, promptPositiveBigInt, promptUint } from './scriptUtils';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const minerAddress = await promptUserFriendlyAddress('Enter Miner address to upgrade', ui, isTestnet);
    const miner = provider.open(Miner.createFromAddress(minerAddress.address));

    let current: Awaited<ReturnType<typeof miner.getMinerData>> | null = null;
    try {
        current = await miner.getMinerData();
        ui.write('Current miner data loaded from get_miner_data. Empty prompts will preserve current values.');
        ui.write(`Owner: ${compactAddress(current.ownerAddress, isTestnet)}`);
        ui.write(`Jetton wallet: ${compactAddress(current.jettonWalletAddress, isTestnet)}`);
        ui.write(`Reward amount: ${current.rewardAmount.toString()}`);
    } catch (e: any) {
        ui.write(`Could not read get_miner_data, probably old contract code: ${e.message ?? e}`);
        ui.write('You must enter full config manually. jwall_addr can be null for auto-detect.');
    }

    const owner = await promptOptionalAddress('Enter owner/admin address', ui, isTestnet, current?.ownerAddress ?? provider.sender().address ?? null);
    if (!owner) {
        ui.write('Owner cannot be null');
        return;
    }

    const jwall = await promptOptionalAddress('Enter stored jetton wallet address, or null for auto-detect', ui, isTestnet, current?.jettonWalletAddress ?? null);
    const seed = await promptUint('Enter seed uint128', ui, 128, current?.seed ?? 0x95b9ba60cd32d91a3255029230f8584fn);
    const powComplexity = await promptUint('Enter pow_complexity uint256; bigger = easier', ui, 256, current?.powComplexity ?? (1n << 248n));
    const targetDelta = await promptPositiveBigInt('Enter target seconds between successful mines', ui, current?.targetDelta ?? 60n);
    const minCpl = await promptUint('Enter min_cpl uint8', ui, 8, current?.minCpl ?? 240n);
    const maxCpl = await promptUint('Enter max_cpl uint8', ui, 8, current?.maxCpl ?? 252n);
    const rewardAmount = await promptPositiveBigInt('Enter reward_amount in jetton base units', ui, current?.rewardAmount ?? 100000000n);
    const value = await promptPositiveBigInt('Enter TON value for upgrade in nanotons', ui, toNano('0.1'));

    if (minCpl > maxCpl) {
        ui.write('min_cpl cannot be greater than max_cpl');
        return;
    }

    const newCode = await compile('Miner');
    const newData = minerConfigToCell({
        owner_addr: owner,
        jwall_addr: jwall,
        seed,
        pow_complexity: powComplexity,
        last_success: current?.lastSuccess ?? nowUnix(),
        target_delta: targetDelta,
        min_cpl: minCpl,
        max_cpl: maxCpl,
        reward_amount: rewardAmount,
    });

    if (!(await promptBool(`Upgrade Miner ${compactAddress(minerAddress.address, isTestnet)}?`, ['yes', 'no'], ui))) {
        return;
    }

    await miner.sendUpgrade(provider.sender(), newCode, newData, value, BigInt(Date.now()));
    ui.write('Upgrade transaction sent');
}
