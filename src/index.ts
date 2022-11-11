import { Command } from "commander";
import { load } from "js-yaml";
import { readFileSync, createWriteStream, existsSync, WriteStream } from "fs";
import { parse } from "csv-parse";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { KeyringPair, KeyringPair$Json } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/keyring";
import { createLogger } from "@w3f/logger";
import '@polkadot/api-augment';

interface Config {
  end_point: string;
  rewardsDestination: RewardsDestination;
  keystore: Keystore;
}

interface RewardsDestination {
  mainDestinationAddress: string;
  mainDestinationShare: string;
  dustDestinationAddress: string;
}

interface Keystore {
  walletFilePath: string;
  password: string;
}

function abort() {
  process.exit(1);
}

const start = async (args: { config: string }): Promise<void> => {
  const log = createLogger("debug");

  // Parse Config
  log.debug(`Reading config from file ${args.config}`);
  const config = load(readFileSync(args.config, "utf8")) as Config;

  // Parse and decode provided account.
  log.debug(`Reading account key from ${config.keystore.walletFilePath}`);
  const keyring = new Keyring({ type: "sr25519" });
  const json = JSON.parse(readFileSync(config.keystore.walletFilePath, "utf8"));
  const account = keyring.addFromJson(json);
  account.decodePkcs8(config.keystore.password);

  if (account.isLocked) {
    log.error("Failed to initialize keystore, account is locked");
    abort();
  }

  // Initialize RPC endpoint.
	const wsProvider = new WsProvider(config.end_point);
	const api = await ApiPromise.create({ provider: wsProvider });
  
  const { data: balance } = await api.query.system.account(account.address);
  const decimals = api.registry.chainDecimals;
  const base = 10**Number(decimals)
  const dm = Number(balance.free) / base
  log.debug(`Account ${account.address} has free balance of: ${dm} ${api.registry.chainTokens}`)

  const existentialDeposit = Number(api.consts.balances.existentialDeposit) / base;
  // Sending funds to addresses
  const share = parseFloat(config.rewardsDestination.mainDestinationShare) / 100;
  log.debug(`Share split: ${share * 100}%`)
  const mainBalance = (Number(balance.free)/ base) *share;
  const dustBalance = (Number(balance.free)/ base) * (1-share);
  log.debug(`Will send ${mainBalance} ${api.registry.chainTokens} to ${config.rewardsDestination.mainDestinationAddress}`)
  log.debug(`Will send ${dustBalance} ${api.registry.chainTokens} (minus fees) to ${config.rewardsDestination.dustDestinationAddress}`)
  if(mainBalance < existentialDeposit || dustBalance < existentialDeposit) {
    log.debug(`Warning, sending less than the Existencial Deposit! If target address has less than that it will be lost! Press Ctrl+C now to stop!`)
    await delay(10000);
  }
  const transfers = [
    api.tx.balances.transfer(config.rewardsDestination.mainDestinationAddress, mainBalance * base),
    api.tx.balances.transferAll(config.rewardsDestination.dustDestinationAddress, false)
  ];
  await api.tx.utility
  .batch(transfers)
  .signAndSend(account, ({ status }) => {
    if (status.isInBlock) {
      console.log(`included in ${status.asInBlock}`);
    }
  });
  wsProvider.disconnect();
};

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

const command = new Command()
  .description("Execute the CSV payouts")
  .option("-c, --config [path]", "Path to config file.", "./config/main.yaml")
  .action(start);

command.parse();
