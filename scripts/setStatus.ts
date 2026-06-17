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
import { intToLockType, LOCK_TYPES, LockType } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';

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
        const ownerIsDeployed = await provider.isContractDeployed(ownerAddress.address);
        const walletWasDeployed = await provider.isContractDeployed(jettonWalletAddress);

        ui.write(`Owner/pool contract status: ${ownerIsDeployed ? 'active' : 'not deployed'}`);
        ui.write(`Jetton wallet address: ${jettonWalletAddress.toString({ testOnly: isTestnet })}`);

        if (walletWasDeployed) {
            await checkJettonWallet({
                address: jettonWalletAddress,
                isBounceable: true,
                isTestOnly: isTestnet,
            }, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, false);
        } else {
            ui.write('Jetton wallet is not deployed yet. set_status will deploy it with StateInit.');
        }

        if (!ownerIsDeployed) {
            ui.write('WARNING: owner/pool contract itself is not deployed. set_status can deploy only its jetton-wallet. Deposits with forward payload will not execute pool logic until the owner/pool contract is deployed.');
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

        if (!walletWasDeployed) {
            try {
                await provider.waitForDeploy(jettonWalletAddress);
            } catch (e: any) {
                ui.write(`Jetton wallet was not deployed after set_status. If the minter is already live, upgrade it to the version that sends StateInit for set_status. Error: ${e.message ?? e}`);
                return;
            }
        }

        const jettonWalletContract = provider.open(JettonWallet.createFromAddress(jettonWalletAddress));
        const status = await jettonWalletContract.getWalletStatus();
        ui.write(`Jetton wallet status after set_status: ${lockTypeToName(intToLockType(status))}`);
    } catch (e: any) {
        ui.write(e.message ?? String(e));
    }
}
