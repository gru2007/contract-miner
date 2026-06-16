import { Address, Cell, fromNano } from '@ton/core';
import { NetworkProvider, UIProvider } from '@ton/blueprint';

export function parseBigIntFlexible(src: string): bigint {
    const s = src.trim().replace(/_/g, '');
    if (s.length === 0) {
        throw new Error('Empty number');
    }
    return s.startsWith('0x') || s.startsWith('0X') ? BigInt(s) : BigInt(s);
}

export async function promptBigInt(
    prompt: string,
    ui: UIProvider,
    fallback?: bigint,
    validate?: (value: bigint) => string | null,
): Promise<bigint> {
    const label = fallback === undefined ? prompt : `${prompt} (default: ${fallback.toString()})`;

    while (true) {
        const raw = (await ui.input(label)).trim();
        try {
            const value = raw.length === 0 && fallback !== undefined ? fallback : parseBigIntFlexible(raw);
            const error = validate?.(value);
            if (error) {
                throw new Error(error);
            }
            return value;
        } catch (e: any) {
            ui.write(e.message ?? String(e));
        }
    }
}

export async function promptUint(
    prompt: string,
    ui: UIProvider,
    bits: number,
    fallback?: bigint,
): Promise<bigint> {
    const max = 1n << BigInt(bits);
    return promptBigInt(prompt, ui, fallback, (value) => {
        if (value < 0n) return 'Value must be non-negative';
        if (value >= max) return `Value must fit uint${bits}`;
        return null;
    });
}

export async function promptPositiveBigInt(prompt: string, ui: UIProvider, fallback?: bigint): Promise<bigint> {
    return promptBigInt(prompt, ui, fallback, (value) => value > 0n ? null : 'Value must be positive');
}

export async function promptOptionalAddress(
    prompt: string,
    ui: UIProvider,
    isTestnet: boolean,
    fallback?: Address | null,
): Promise<Address | null> {
    const fallbackText = fallback === undefined
        ? ''
        : fallback === null
            ? ' (default: null)'
            : ` (default: ${fallback.toString({ testOnly: isTestnet })})`;

    while (true) {
        const raw = (await ui.input(`${prompt}${fallbackText}`)).trim();
        if (raw.length === 0 && fallback !== undefined) {
            return fallback;
        }
        if (raw.length === 0 || raw.toLowerCase() === 'null' || raw === '-') {
            return null;
        }
        try {
            return Address.parse(raw);
        } catch (e) {
            ui.write(`${raw} is not a valid address`);
        }
    }
}

export async function getContractBalance(provider: NetworkProvider, address: Address): Promise<bigint> {
    const state = await provider.provider(address).getState();
    return state.balance;
}

export function compactAddress(address: Address | null | undefined, isTestnet: boolean): string {
    if (!address) return 'null';
    return address.toString({ testOnly: isTestnet });
}

export function bigintToBufferBE(value: bigint, bytes: number): Buffer {
    if (value < 0n || value >= (1n << BigInt(bytes * 8))) {
        throw new Error(`Value does not fit ${bytes} bytes`);
    }
    return Buffer.from(value.toString(16).padStart(bytes * 2, '0'), 'hex');
}

export function bufferToBigInt(buffer: Buffer): bigint {
    if (buffer.length === 0) return 0n;
    return BigInt(`0x${buffer.toString('hex')}`);
}

export function formatTon(value: bigint): string {
    return `${fromNano(value)} TON`;
}

export function formatTargetBits(powComplexity: bigint): string {
    if (powComplexity <= 0n) return '0';
    return `~2^${powComplexity.toString(2).length - 1}`;
}

export function nowUnix(): bigint {
    return BigInt(Math.floor(Date.now() / 1000));
}

export function cellHashInt(cell: Cell): bigint {
    return bufferToBigInt(cell.hash());
}
