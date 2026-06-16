import { fromNano, toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { addressToString, jettonWalletCodeFromLibrary, promptAmount, promptBool, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { checkJettonMinter } from './JettonMinterChecker';
import { fromUnits } from './units';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const minterAddress = await promptUserFriendlyAddress('Enter ZKGRM jetton minter address', ui, isTestnet);
    const minerAddress = await promptUserFriendlyAddress('Enter Miner contract address to fund', ui, isTestnet);

    const { jettonMinterContract, adminAddress, decimals } = await checkJettonMinter(
        minterAddress,
        jettonMinterCode,
        jettonWalletCode,
        provider,
        ui,
        isTestnet,
        true,
    );

    if (!provider.sender().address?.equals(adminAddress)) {
        ui.write('You are not admin of this jetton minter');
        return;
    }

    const amount = await promptAmount('Enter ZKGRM reward reserve amount to mint to Miner', decimals, ui);
    const minerJettonWallet = await jettonMinterContract.getWalletAddress(minerAddress.address);

    ui.write(`Miner jetton wallet: ${minerJettonWallet.toString({ testOnly: isTestnet })}`);
    ui.write('The first mint/transfer_notification lets Miner auto-detect its jetton wallet.');

    if (!(await promptBool(`Mint ${fromUnits(amount, decimals)} ZKGRM to Miner ${addressToString(minerAddress)}?`, ['yes', 'no'], ui))) {
        return;
    }

    await jettonMinterContract.sendMint(
        provider.sender(),
        minerAddress.address,
        amount,
        null,
        provider.sender().address ?? null,
        null,
        toNano('0.05'),
        toNano('0.15'),
    );

    ui.write('Mint transaction sent');
    ui.write(`Expected miner wallet: ${minerJettonWallet.toString({ testOnly: isTestnet })}`);
    ui.write(`After wallet deploy, run setStatus.ts and set this wallet owner/status to protocol if rewards are blocked by wallet policy.`);
    ui.write(`Attached TON for mint: ${fromNano(toNano('0.15'))} TON`);
}
