import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, internal, MessageRelaxed, Sender, SendMode } from '@ton/core';
import {
    Slice,
    toNano
} from '@ton/core';

export type MinerConfig = {
    owner_addr: Address,
    jetton_minter_addr?: Address | null,
    jwall_addr?: Address | null,
    seed: number | bigint,
    pow_complexity: number | bigint,
    last_success: number | bigint,
    target_delta: number | bigint,
    min_cpl: number | bigint,
    max_cpl: number | bigint,
    reward_amount?: number | bigint,
};

export const DEFAULT_REWARD_AMOUNT = 100000000n;

export const GRM_GIVER_PRESETS = {
    extraSmall: {
        count: 2,
        seed: 91364215591814176173860070590035324060n,
        pow_complexity: 411376139330301510538742295639337626245683966408394965837152256n,
        amount: 100000000000n,
        interval: 100n,
    },/*
    small: {
        count: 10,
        seed: 110217239753205694903454587643682599146n,
        pow_complexity: 1725436586697640946858688965569256363112777243042596638790631055949824n,
        amount: 1000000000000n,
        interval: 100n,
    },
    medium: {
        count: 10,
        seed: 5115922642252427458573938635172126545n,
        pow_complexity: 26328072917139296674479506920917608079723773850137277813577744384n,
        amount: 10000000000000n,
        interval: 100000n,
    },
    large: {
        count: 10,
        seed: 146338750163420163575479661938498567997n,
        pow_complexity: 52656145834278593348959013841835216159447547700274555627155488768n,
        amount: 100000000000000n,
        interval: 100000n,
    },*/
} as const;

export abstract class Op {
    static transfer = 0xf8a7ea5;
    static transfer_notification = 0x7362d09c;
    static internal_transfer = 0x178d4519;
    static excesses = 0xd53276db;
    static burn = 0x595f07bc;
    static burn_notification = 0x7bdd97de;
    
    static provide_wallet_address = 0x2c76b973;
    static take_wallet_address = 0xd1735400;
    static mint = 0x642b7d07;
    static change_admin = 0x6501f354;
    static claim_admin = 0xfb88e119;
    static upgrade = 0x2508d66a;
    static call_to = 0x235caf52;
    static top_up = 0xd372158c;
    static change_metadata_url = 0xcb862902;
    static set_status = 0xeed236d3;
}

export function minerConfigToCell(config: MinerConfig): Cell {
    return beginCell()
    .storeAddress(config.owner_addr)
    .storeAddress(config.jetton_minter_addr ?? config.jwall_addr ?? null)
    .storeRef(beginCell()
        .storeUint(config.seed, 128)
        .storeUint(config.pow_complexity, 256)
        .storeUint(config.last_success, 64)
        .storeUint(config.target_delta, 64)
        .storeUint(config.min_cpl, 8)
        .storeUint(config.max_cpl, 8)
        .storeCoins(config.reward_amount ?? DEFAULT_REWARD_AMOUNT)
        .endCell())
    .endCell();
}

export function createGrmGiverConfigs(owner: Address, now: number | bigint, options?: { jetton_minter_addr?: Address | null; jwall_addr?: Address | null; min_cpl?: bigint; max_cpl?: bigint }) {
    const configs: MinerConfig[] = [];
    for (const preset of Object.values(GRM_GIVER_PRESETS)) {
        for (let i = 0; i < preset.count; i++) {
            configs.push({
                owner_addr: owner,
                jetton_minter_addr: options?.jetton_minter_addr ?? options?.jwall_addr ?? null,
                seed: (preset.seed + BigInt(i)) & ((1n << 128n) - 1n),
                pow_complexity: preset.pow_complexity,
                last_success: now,
                target_delta: preset.interval,
                min_cpl: options?.min_cpl ?? 1n,
                max_cpl: options?.max_cpl ?? 255n,
                reward_amount: preset.amount,
            });
        }
    }
    return configs;
}

export function endParse(slice: Slice) {
    if (slice.remainingBits > 0 || slice.remainingRefs > 0) {
        throw new Error('remaining bits in data');
    }
}

export const Opcodes = {
    mine: 0x4d696e65,
    transfer_notification: 0x7362d09c,
    change_settings: 100,
    get_owner: 101,
    owner_response: 102,
    get_ton_balance: 103,
    ton_balance_response: 104,
    withdraw_ton: 105,
};

export class Miner implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Miner(address);
    }

    static createFromConfig(config: MinerConfig, code: Cell, workchain = 0) {
        const data = minerConfigToCell(config);
        const init = { code, data };
        return new Miner(contractAddress(workchain, init), init);
    }

    static createDeployMessage(contract: Miner, value: bigint): MessageRelaxed {
        return internal({
            to: contract.address,
            value,
            init: contract.init,
            body: beginCell().endCell(),
        });
    }

    static createGiversFromConfigs(configs: MinerConfig[], code: Cell, workchain = 0) {
        return configs.map((config) => Miner.createFromConfig(config, code, workchain));
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    static upgradeMessage(new_code: Cell, new_data: Cell, query_id: bigint | number = 0) {
        return beginCell().storeUint(Op.upgrade, 32).storeUint(query_id, 64)
            .storeRef(new_data)
            .storeRef(new_code)
            .endCell();
    }

    static parseUpgrade(slice: Slice) {
        const op = slice.loadUint(32);
        if (op !== Op.upgrade) throw new Error('Invalid op');
        const queryId = slice.loadUint(64);
        const newData = slice.loadRef();
        const newCode = slice.loadRef();
        endParse(slice);
        return {
            queryId,
            newData,
            newCode
        }
    }


    async sendUpgrade(provider: ContractProvider, via: Sender, new_code: Cell, new_data: Cell, value: bigint = toNano('0.1'), query_id: bigint | number = 0) {
        return await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Miner.upgradeMessage(new_code, new_data, query_id),
            value
        });
    }

    static withdrawTonMessage(recipient: Address, amount: bigint, query_id: bigint | number = 0) {
        return beginCell()
            .storeUint(Opcodes.withdraw_ton, 32)
            .storeUint(query_id, 64)
            .storeAddress(recipient)
            .storeCoins(amount)
            .endCell();
    }

    async sendWithdrawTon(provider: ContractProvider, via: Sender, recipient: Address, amount: bigint, value: bigint = toNano('0.05'), query_id: bigint | number = 0) {
        return await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Miner.withdrawTonMessage(recipient, amount, query_id),
            value,
        });
    }

    static mineMessage(params: {
        flags?: number;
        expire: number | bigint;
        whom?: number | bigint;
        rdata: number | bigint;
        rseed: number | bigint;
        recipient?: Address | null;
    }) {
        const body = beginCell()
            .storeUint(Opcodes.mine, 32)
            .storeInt(params.flags ?? 0, 8)
            .storeUint(params.expire, 32)
            .storeUint(params.whom ?? 0, 256)
            .storeUint(params.rdata, 256)
            .storeUint(params.rseed, 128)
            .storeUint(params.rdata, 256);
        if (params.recipient) {
            body.storeRef(beginCell().storeAddress(params.recipient).endCell());
        }
        return body.endCell();
    }

    async sendMine(provider: ContractProvider, via: Sender, value: bigint, params: {
        flags?: number;
        expire: number | bigint;
        whom?: number | bigint;
        rdata: number | bigint;
        rseed: number | bigint;
        recipient?: Address | null;
    }) {
        return await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Miner.mineMessage(params),
            value,
        });
    }

    async getPowParams(provider: ContractProvider) {
        const { stack } = await provider.get('get_pow_params', []);
        return {
            seed: stack.readBigNumber(),
            powComplexity: stack.readBigNumber(),
            amount: stack.readBigNumber(),
            targetDelta: stack.readBigNumber(),
        };
    }

    async getJettonWalletAddress(provider: ContractProvider) {
        const { stack } = await provider.get('get_jetton_wallet_address', []);
        return stack.readAddressOpt();
    }

    async getJettonMinterAddress(provider: ContractProvider) {
        const { stack } = await provider.get('get_jetton_minter_address', []);
        return stack.readAddressOpt();
    }

    async getRewardAmount(provider: ContractProvider) {
        const { stack } = await provider.get('get_reward_amount', []);
        return stack.readBigNumber();
    }

    async getMiningConfig(provider: ContractProvider) {
        const { stack } = await provider.get('get_mining_config', []);
        return {
            seed: stack.readBigNumber(),
            powComplexity: stack.readBigNumber(),
            targetDelta: stack.readBigNumber(),
            minCpl: stack.readBigNumber(),
            maxCpl: stack.readBigNumber(),
            rewardAmount: stack.readBigNumber(),
        };
    }

    async getMinerData(provider: ContractProvider) {
        const { stack } = await provider.get('get_miner_data', []);
        return {
            ownerAddress: stack.readAddress(),
            jettonMinterAddress: stack.readAddressOpt(),
            seed: stack.readBigNumber(),
            powComplexity: stack.readBigNumber(),
            lastSuccess: stack.readBigNumber(),
            targetDelta: stack.readBigNumber(),
            minCpl: stack.readBigNumber(),
            maxCpl: stack.readBigNumber(),
            rewardAmount: stack.readBigNumber(),
        };
    }

}
