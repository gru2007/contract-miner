import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import {
    Slice,
    toNano
} from '@ton/core';

export type MinerConfig = {
    owner_addr: Address,
    jwall_addr: Address,
    seed: number | bigint,
    pow_complexity: number | bigint,
    last_success: number | bigint,
    target_delta: number | bigint,
    min_cpl: number | bigint,
    max_cpl: number | bigint,
};

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
    .storeAddress(config.jwall_addr)
    .storeRef(beginCell()
        .storeUint(config.seed, 128)
        .storeUint(config.pow_complexity, 256)
        .storeUint(config.last_success, 64)
        .storeUint(config.target_delta, 64)
        .storeUint(config.min_cpl, 8)
        .storeUint(config.max_cpl, 8)
        .endCell())
    .endCell();
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

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
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
        await provider.internal(via, {
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
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Miner.withdrawTonMessage(recipient, amount, query_id),
            value,
        });
    }

}
