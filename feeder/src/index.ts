import { ArgumentParser } from "argparse";
import * as dotenv from "dotenv"; // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import * as packageInfo from "../package.json";
import { addKey } from "./addKey";
import { vote } from "./vote";
dotenv.config();

function registerCommands(parser: ArgumentParser): void {
  const subparsers = parser.addSubparsers({
    title: `commands`,
    dest: `subparser_name`,
    description: `Available commands`,
  });

  // Voting command
  const voteCommand = subparsers.addParser(`vote`, {
    addHelp: true,
    description: `Fetch price and broadcast oracle messages`,
  });

  voteCommand.addArgument(["-l", "--rpc-url"], {
    help: "rpc address",
    dest: "rpcUrl",
    required: false,
  });

  voteCommand.addArgument([`-c`, `--chain-id`], {
    action: `store`,
    help: `chain ID`,
    dest: `chainID`,
    required: false,
  });

  voteCommand.addArgument([`--validators`], {
    action: `append`,
    help: `validators address (e.g. oraclevaloper1...), can have multiple`,
    required: false,
  });

  voteCommand.addArgument([`-d`, `--data-source-url`], {
    action: `append`,
    help: `Append price data source(It can handle multiple sources)`,
    dest: `dataSourceUrl`,
    required: false,
  });

  voteCommand.addArgument([`-p`, `--password`], {
    action: `store`,
    help: `voter password`,
  });

  voteCommand.addArgument([`-k`, `--key-path`, `--keystore`], {
    action: `store`,
    help: `key store path to save encrypted key`,
    dest: `keyPath`,
    required: false,
  });

  voteCommand.addArgument([`-n`, `--key-name`], {
    help: `name assigned to the generated key`,
    dest: `keyName`,
    defaultValue: `voter`,
  });

  voteCommand.addArgument([`-g`, `--gas-price`], {
    help: `gas price string`,
    dest: `gasPrice`,
    defaultValue: `0.00125ukuji`,
  });

  voteCommand.addArgument([`-f`, `--fee-granter`], {
    help: `fee granter address`,
    dest: `feeGranter`,
  });

  // Updating Key command
  const keyCommand = subparsers.addParser(`add-key`, { addHelp: true });

  keyCommand.addArgument([`-n`, `--key-name`], {
    help: `name to assigns to the generated key`,
    dest: `keyName`,
    defaultValue: `voter`,
  });

  keyCommand.addArgument([`-t`, `--coin-type`], {
    help: `coin type used to derive the public address (https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#path-levels)`,
    dest: `coinType`,
    defaultValue: `118`,
  });

  keyCommand.addArgument([`-k`, `--key-path`], {
    help: `key store path to save encrypted key`,
    dest: `keyPath`,
    defaultValue: `voter.json`,
  });
}

async function main(): Promise<void> {
  const parser = new ArgumentParser({
    version: packageInfo.version,
    addHelp: true,
    description: `x/oracle voter`,
  });

  registerCommands(parser);
  const args = parser.parseArgs();

  if (args.subparser_name === `vote`) {
    args.rpcUrl = args.rpcUrl || process.env.RPC_URL;

    args.dataSourceUrl =
      args.dataSourceUrl ||
      (process.env.DATA_SOURCE_URL && process.env.DATA_SOURCE_URL.split(",")) ||
      [];
    args.chainID = args.chainID || process.env.CHAIN_ID || "harpoon-4";
    if (
      args.rpcUrl?.length === 0 ||
      args.dataSourceUrl?.length === 0 ||
      args.chainID === ""
    ) {
      console.error("Missing --rpc, --chain-id or --data-source-url");
      return;
    }

    args.keyPath = args.keyPath || process.env.KEY_PATH || "voter.json";
    args.password = args.password || process.env.PASSWORD || "";
    if (args.keyPath === "" || args.password === "") {
      console.error("Missing either --key-path or --password");
      return;
    }

    // validators is skippable and default value will be extracted from the key
    args.validators =
      args.validators ||
      (process.env.VALIDATORS && process.env.VALIDATORS.split(","));

    args.prefix = process.env.ADDR_PREFIX;

    args.keyName = process.env.KEY_NAME ? process.env.KEY_NAME : args.keyName;
    args.gasPrice = process.env.GAS_PRICE
      ? process.env.GAS_PRICE
      : args.gasPrice;

    args.feeGranter = process.env.FEE_GRANTER
      ? process.env.FEE_GRANTER
      : args.feeGranter;

    await vote(args);
  } else if (args.subparser_name === `add-key`) {
    await addKey(args.keyPath, args.coinType, args.keyName);
  }
}

main().catch((e) => {
  console.error(e);
});
