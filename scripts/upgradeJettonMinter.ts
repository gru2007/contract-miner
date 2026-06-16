import { compile, NetworkProvider } from '@ton/blueprint';
import { jettonMinterConfigToCell } from '../wrappers/JettonMinter';
import { jettonWalletCodeFromLibrary, promptBool, promptUrl, promptUserFriendlyAddress } from '../wrappers/ui-utils';
import { checkJettonMinter } from './JettonMinterChecker';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    ui.write('Warning: in the latest ZKGRM wallet-policy concept, upgrade paths may be intentionally disabled in contract code.');
    ui.write('Use this only if your deployed JettonMinter still supports Op.upgrade.');

    const jettonMinterCodeRaw = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonMinterAddress = await promptUserFriendlyAddress('Enter the address of the jetton minter', ui, isTestnet);
    const jettonMetadataUri = await promptUrl('Enter new jetton metadata uri', ui);

    const { jettonMinterContract, adminAddress } = await checkJettonMinter(
        jettonMinterAddress,
        jettonMinterCodeRaw,
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

    if (!(await promptBool('Send upgrade transaction?', ['yes', 'no'], ui))) {
        return;
    }

    await jettonMinterContract.sendUpgrade(
        provider.sender(),
        jettonMinterCodeRaw,
        jettonMinterConfigToCell({
            admin: adminAddress,
            wallet_code: jettonWalletCode,
            jetton_content: { uri: jettonMetadataUri },
        }),
    );

    ui.write('Upgrade transaction sent');
}
