import { Address, Cell, fromNano, OpenedContract } from '@ton/core';
import { NetworkProvider, UIProvider } from '@ton/blueprint';
import {
    addressToString,
    assert,
    base64toCell,
    formatAddressAndUrl,
    lockTypeToName,
    parseContentCell,
    sendToIndex,
} from '../wrappers/ui-utils';
import { JettonWallet, parseJettonWalletData } from '../wrappers/JettonWallet';
import { intToLockType, JettonMinter } from '../wrappers/JettonMinter';
import { fromUnits } from './units';

export const checkJettonWallet = async (
    jettonWalletAddress: {
        isBounceable: boolean;
        isTestOnly: boolean;
        address: Address;
    },
    jettonMinterCode: Cell,
    jettonWalletCode: Cell,
    provider: NetworkProvider,
    ui: UIProvider,
    isTestnet: boolean,
    silent: boolean,
) => {
    const write = (message: string) => {
        if (!silent) ui.write(message);
    };

    const result = await sendToIndex('account', { address: addressToString(jettonWalletAddress) }, provider);
    write(`Contract status: ${result.status}`);
    assert(result.status === 'active', 'Contract not active', ui);
    write(`Toncoin balance on jetton-wallet: ${fromNano(result.balance)} TON`);

    const data = base64toCell(result.data);
    const parsedData = parseJettonWalletData(data);

    const jettonMinterContract: OpenedContract<JettonMinter> = provider.open(
        JettonMinter.createFromAddress(parsedData.jettonMasterAddress),
    );
    const expectedWallet = await jettonMinterContract.getWalletAddress(parsedData.ownerAddress);
    assert(expectedWallet.equals(jettonWalletAddress.address), 'fake jetton-minter / wallet address mismatch', ui);

    const { content } = await jettonMinterContract.getJettonData();
    let decimals = 9;
    const parsedContent = await parseContentCell(content);
    if (typeof parsedContent !== 'string') {
        const decimalsString = (parsedContent as Record<string, string>).decimals;
        if (decimalsString !== undefined) {
            const parsedDecimals = Number.parseInt(decimalsString, 10);
            if (!Number.isNaN(parsedDecimals)) decimals = parsedDecimals;
        }
    }

    const jettonWalletContract: OpenedContract<JettonWallet> = provider.open(
        JettonWallet.createFromAddress(jettonWalletAddress.address),
    );
    const getData = await jettonWalletContract.getWalletData();

    assert(getData.balance === parsedData.balance, "Balance doesn't match", ui);
    assert(getData.owner.equals(parsedData.ownerAddress), "Owner address doesn't match", ui);
    assert(getData.minter.equals(parsedData.jettonMasterAddress), "Jetton master address doesn't match", ui);
    assert(getData.wallet_code.equals(jettonWalletCode), "Jetton-wallet code doesn't match", ui);

    const status = await jettonWalletContract.getWalletStatus();
    assert(status === parsedData.status, "Jetton wallet status doesn't match", ui);

    const recreated = JettonWallet.createFromConfig({
        ownerAddress: parsedData.ownerAddress,
        jettonMasterAddress: parsedData.jettonMasterAddress,
    }, jettonWalletCode);

    if (recreated.address.equals(jettonWalletAddress.address)) {
        write('StateInit matches');
    } else {
        write(`StateInit does not match. Recreated address: ${recreated.address.toString({ testOnly: isTestnet })}`);
    }

    write(`Jetton-wallet status: ${lockTypeToName(intToLockType(parsedData.status))}`);
    write(`Balance: ${fromUnits(parsedData.balance, decimals)}`);
    write(`Owner address: ${await formatAddressAndUrl(parsedData.ownerAddress, provider, isTestnet)}`);
    write(`Jetton-minter address: ${await formatAddressAndUrl(parsedData.jettonMasterAddress, provider, isTestnet)}`);

    return {
        jettonWalletContract,
        jettonBalance: parsedData.balance,
        ownerAddress: parsedData.ownerAddress,
        jettonMasterAddress: parsedData.jettonMasterAddress,
        status: parsedData.status,
        decimals,
    };
};
