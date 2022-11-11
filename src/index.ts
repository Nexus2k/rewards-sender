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

	// For each provided entry in the CSV file, execute the balance.
  const { data: balance } = await api.query.system.account(account.address);
  log.debug(`Account ${account.address} has free balance of: ${balance.free.toHuman()}`)

  wsProvider.disconnect();
};

const command = new Command()
  .description("Execute the CSV payouts")
  .option("-c, --config [path]", "Path to config file.", "./config/main.yaml")
  .action(start);

command.parse();
