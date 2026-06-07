import { toNano } from '@ton/core';
import { Miner } from '../wrappers/Miner';
import { compile, NetworkProvider } from '@ton/blueprint';
import {jettonWalletCodeFromLibrary, promptUrl, promptUserFriendlyAddress} from "../wrappers/ui-utils";

export async function run(provider: NetworkProvider) {

	const ui = provider.ui();
	const adminAddr = await promptUserFriendlyAddress("Enter the address of the owner", ui, true);
	const jettonWallet = await promptUserFriendlyAddress("Enter the address of the jetton wallet", ui, true);
    const now = BigInt(Math.floor(Date.now() / 1000));

    // Miner data Cell stores owner_addr and jwall_addr in the root cell, then all PoW params in one ref:
    // owner_addr: MsgAddress - admin address allowed to change settings / upgrade the miner.
    // jwall_addr: MsgAddress - jetton wallet address owned by this miner; rewards are sent from it.
    // seed: uint128 - current PoW challenge seed returned by get_pow_params(); choose any random non-zero
    //   128-bit value for deploy/upgrade. Miners must use the current on-chain seed; after each successful
    //   mine the contract replaces it with a new random seed, so this is not a difficulty knob. Use bigint
    //   literals with `n` suffix for 128-bit values; JS number loses precision here.
    // pow_complexity: uint256 - PoW target threshold checked as `slice_hash(mine_body) < pow_complexity`.
    //   Bigger value means easier mining, smaller value means harder mining. Initial value should be inside
    //   [2^min_cpl, 2^max_cpl], because future retargeting is clamped to that range. Use bigint literals
    //   with `n` suffix for 256-bit values; JS number loses precision here.
    //   Browser-friendly start below uses 2^248, so expected work is about 2^(256 - 248) = 256 hashes.
    // last_success: uint64 - unix time of the previous successful mine. For first deploy use current unix
    //   time if you want normal first retargeting; using 1 makes the first delta very large, but the contract
    //   caps one-step retargeting to 9/8.
    // target_delta: uint64 - desired seconds between successful mines. If actual delta is larger, mining gets
    //   easier; if smaller, mining gets harder. Example: 60 means target about one success per minute.
    // min_cpl: uint8 - lower clamp exponent for pow_complexity, stored as 2^min_cpl. This is the hardest
    //   allowed target after retargeting.
    // max_cpl: uint8 - upper clamp exponent for pow_complexity, stored as 2^max_cpl. This is the easiest
    //   allowed target after retargeting.
    const miner = provider.open(
        Miner.createFromConfig(
            {
                owner_addr: adminAddr.address,
			    jwall_addr: jettonWallet.address,
			    seed: 0x95b9ba60cd32d91a3255029230f8584fn,
			    pow_complexity: 1n << 248n,
			    last_success: now,
			    target_delta: 60n,
			    min_cpl: 240,
			    max_cpl: 252,
            },
            await compile('Miner')
        )
    );

    await miner.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(miner.address);
}
