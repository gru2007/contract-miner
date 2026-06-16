import { compile, NetworkProvider } from '@ton/blueprint';
import {
    addressToString,
    jettonWalletCodeFromLibrary,
    lockTypeToName,
    promptBool,
    promptLockType,
    promptUserFriendlyAddress,
} from '../wrappers/ui-utils';
import { checkJettonMinter } from './JettonMinterChecker';
import { checkJettonWallet } from './JettonWalletChecker';
import { LOCK_TYPES, LockType } from '../wrappers/JettonMinter';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonMinterAddress = await promptUserFriendlyAddress('Enter ZKGRM jetton minter address', ui, isTestnet);

    try {
        const { jettonMinterContract, adminAddress } = await checkJettonMinter(
            jettonMinterAddress,
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

        const ownerAddress = await promptUserFriendlyAddress('Enter wallet owner address: user, DEX, Miner or ZK pool', ui, isTestnet);
        const jettonWalletAddress = await jettonMinterContract.getWalletAddress(ownerAddress.address);

        ui.write(`Jetton wallet address: ${jettonWalletAddress.toString({ testOnly: isTestnet })}`);

        if (await provider.isContractDeployed(jettonWalletAddress)) {
            await checkJettonWallet({
                address: jettonWalletAddress,
                isBounceable: true,
                isTestOnly: isTestnet,
            }, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, false);
        } else {
            ui.write('Jetton wallet is not deployed yet. set_status will deploy only if your wallet contract/minter flow supports that path; usually mint/transfer first.');
        }

        LOCK_TYPES.forEach((lockType) => {
            ui.write(`${lockType} - ${lockTypeToName(lockType as LockType)}`);
        });

        const newStatus = await promptLockType(`Enter new status (${LOCK_TYPES.join(', ')})`, ui);

        if (!(await promptBool(`Set ${addressToString(ownerAddress)} wallet to ${newStatus}?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendLockWallet(provider.sender(), ownerAddress.address, newStatus);
        ui.write('set_status transaction sent');
    } catch (e: any) {
        ui.write(e.message ?? String(e));
    }
}
