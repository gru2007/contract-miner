import {
    addressToString,
    assert,
    base64toCell,
    equalsMsgAddresses,
    formatAddressAndUrl,
    parseContentCell,
    sendToIndex,
} from '../wrappers/ui-utils';
import { Address, Cell, fromNano, OpenedContract } from '@ton/core';
import { JettonMinter, parseJettonMinterData } from '../wrappers/JettonMinter';
import { NetworkProvider, UIProvider } from '@ton/blueprint';
import { fromUnits } from './units';

export const checkJettonMinter = async (
    jettonMinterAddress: {
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

    const result = await sendToIndex('account', { address: addressToString(jettonMinterAddress) }, provider);
    write(`Contract status: ${result.status}`);
    assert(result.status === 'active', 'Contract not active', ui);
    write(`Toncoin balance on jetton-minter: ${fromNano(result.balance)} TON`);

    const data = base64toCell(result.data);
    const parsedData = parseJettonMinterData(data);
    const metadataUrl = (parsedData.jetton_content as Cell).beginParse().loadStringTail();

    const jettonMinterContract: OpenedContract<JettonMinter> = provider.open(
        JettonMinter.createFromAddress(jettonMinterAddress.address),
    );
    const getData = await jettonMinterContract.getJettonData();

    assert(getData.totalSupply === parsedData.supply, "Total supply doesn't match", ui);
    assert(getData.adminAddress.equals(parsedData.admin), "Admin address doesn't match", ui);
    assert(getData.walletCode.equals(parsedData.wallet_code), "Jetton-wallet code doesn't match", ui);

    let decimals = 9;
    const parsedContent = await parseContentCell(getData.content);
    if (typeof parsedContent === 'string') {
        assert(parsedContent === metadataUrl, "Metadata URL doesn't match", ui);
        write(`Metadata URL: "${metadataUrl}"`);
    } else {
        const contentMap: Record<string, string> = parsedContent as Record<string, string>;
        if (contentMap.uri) {
            assert(contentMap.uri === metadataUrl, "Metadata URL doesn't match", ui);
        }
        const decimalsString = contentMap.decimals;
        if (decimalsString !== undefined) {
            const parsedDecimals = Number.parseInt(decimalsString, 10);
            if (!Number.isNaN(parsedDecimals)) {
                decimals = parsedDecimals;
            }
        }
    }

    const getNextAdminAddress = await jettonMinterContract.getNextAdminAddress();
    assert(equalsMsgAddresses(getNextAdminAddress, parsedData.transfer_admin), "Next admin address doesn't match", ui);

    const recreated = JettonMinter.createFromConfig({
        admin: parsedData.admin,
        wallet_code: jettonWalletCode,
        jetton_content: { uri: metadataUrl },
    }, jettonMinterCode);

    if (recreated.address.equals(jettonMinterAddress.address)) {
        write('StateInit matches');
    } else {
        write(`StateInit does not match. Recreated address: ${recreated.address.toString({ testOnly: isTestnet })}`);
    }

    write(`Decimals: ${decimals}`);
    write(`Total Supply: ${fromUnits(parsedData.supply, decimals)}`);
    write(`Mintable: ${getData.mintable}`);
    write(`Metadata URL: "${metadataUrl}"`);
    write(`Current admin address: ${await formatAddressAndUrl(parsedData.admin, provider, isTestnet)}`);

    const nextAdminAddress = parsedData.transfer_admin;
    write(
        nextAdminAddress
            ? `Next admin address: ${await formatAddressAndUrl(nextAdminAddress, provider, isTestnet)}`
            : 'Next admin address: null',
    );

    return {
        jettonMinterContract,
        adminAddress: parsedData.admin,
        nextAdminAddress: parsedData.transfer_admin,
        decimals,
        metadataUrl,
    };
};
