import { toNano } from '@ton/core';
import { randomBytes } from 'crypto';
import { NetworkProvider, UIProvider } from '@ton/blueprint';
import { addressHash, MineMode, Miner } from '../wrappers/Miner';
import { promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { bufferToBigInt, cellHashInt, formatTargetBits, promptBigInt, promptOptionalAddress, promptPositiveBigInt } from './scriptUtils';

const UINT128_MASK = (1n << 128n) - 1n;

function randomUint128(): bigint {
    return bufferToBigInt(randomBytes(16));
}

async function findSolution(params: {
    seed: bigint;
    powComplexity: bigint;
    expire: bigint;
    whom: bigint;
    flags: number;
    mode: MineMode;
    recipient: Parameters<typeof Miner.mineMessage>[0]['recipient'];
    maxAttempts: bigint;
    ui: UIProvider;
}) {
    let nonce = randomUint128();

    for (let attempt = 0n; attempt < params.maxAttempts; attempt++) {
        const candidate = (nonce + attempt) & UINT128_MASK;
        const bodyForHash = Miner.mineMessage({
            mode: params.mode,
            flags: params.flags,
            expire: params.expire,
            whom: params.whom,
            rdata: candidate,
            rseed: params.seed,
            recipient: params.mode === 'secure' ? params.recipient : null,
        });

        const hash = cellHashInt(bodyForHash);

        if ((attempt % 10000n) === 0n) {
            params.ui.setActionPrompt(`Mining attempt ${attempt.toString()}, hash ${hash.toString(16).slice(0, 12)}...`);
        }

        if (hash < params.powComplexity) {
            params.ui.clearActionPrompt();
            return { rdata: candidate, rseed: params.seed, hash, attempts: attempt + 1n };
        }
    }

    params.ui.clearActionPrompt();
    return null;
}

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const minerAddress = await promptUserFriendlyAddress('Enter Miner address', ui, isTestnet);

    if (!(await provider.isContractDeployed(minerAddress.address))) {
        ui.write('Miner is not deployed');
        return;
    }

    const miner = provider.open(Miner.createFromAddress(minerAddress.address));
    const pow = await miner.getPowParams();

    ui.write(`Seed: ${pow.seed.toString()}`);
    ui.write(`PoW complexity: ${pow.powComplexity.toString()} (${formatTargetBits(pow.powComplexity)})`);
    ui.write(`Reward amount: ${pow.amount.toString()} base units`);
    ui.write(`Target delta: ${pow.targetDelta.toString()} sec`);

    const sender = provider.sender().address;
    const recipient = await promptOptionalAddress('Enter reward recipient address, or empty for sender', ui, isTestnet, sender ?? null);
    if (!recipient) {
        ui.write('Recipient cannot be null when sender address is unavailable');
        return;
    }

    const ttl = await promptPositiveBigInt('Enter proof TTL in seconds', ui, 600n);
    const expire = BigInt(Math.floor(Date.now() / 1000)) + ttl;
    const maxAttempts = await promptPositiveBigInt('Enter max local hash attempts', ui, 5000000n);
    const value = await promptBigInt('Enter TON value to attach in nanotons', ui, toNano('1.2'));
    const secure = await promptBool('Use secure mining mode? / Безопасный режим майнинга?', ['yes', 'no'], ui, true);
    const mode: MineMode = secure ? 'secure' : 'legacy';
    const flags = 0;
    const whom = secure ? addressHash(recipient) : 0n;

    if (!secure) {
        ui.write('WARNING: legacy Mine mode does not bind the proof to the recipient. A front-runner can steal a reward by changing recipient. / ВНИМАНИЕ: legacy режим не привязывает proof к получателю, награду можно украсть фронтраном.');
    }

    ui.write('Searching local PoW solution...');
    const solution = await findSolution({
        seed: pow.seed,
        powComplexity: pow.powComplexity,
        expire,
        whom,
        flags,
        mode,
        recipient,
        maxAttempts,
        ui,
    });

    if (!solution) {
        ui.write(`No solution found in ${maxAttempts.toString()} attempts. Increase maxAttempts or check difficulty.`);
        return;
    }

    ui.write(`Solution found after ${solution.attempts.toString()} attempts`);
    ui.write(`rdata: ${solution.rdata.toString()}`);
    ui.write(`rseed: ${solution.rseed.toString()}`);
    ui.write(`hash: 0x${solution.hash.toString(16).padStart(64, '0')}`);

    if (!(await promptBool(`Send mine transaction and reward ${recipient.toString({ testOnly: isTestnet })}?`, ['yes', 'no'], ui))) {
        return;
    }

    await miner.sendMine(provider.sender(), value, {
        mode,
        flags,
        expire,
        whom,
        rdata: solution.rdata,
        rseed: solution.rseed,
        recipient,
    });

    ui.write('Mine transaction sent');
}
