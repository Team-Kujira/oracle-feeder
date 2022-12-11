import { sha256 } from "@cosmjs/crypto";
import { toHex } from "@cosmjs/encoding";
import { Uint53 } from "@cosmjs/math";
import {
  coins,
  DirectSecp256k1HdWallet,
  EncodeObject,
} from "@cosmjs/proto-signing";
import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
  GasPrice,
  SigningStargateClient,
  StdFee,
} from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import axios from "axios";
import * as Bluebird from "bluebird";
import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import { kujiraQueryClient, msg, registry } from "kujira.js";
import { MsgAggregateExchangeRateVote } from "kujira.js/lib/cjs/kujira/kujira.oracle/types/tx";
import * as promptly from "promptly";
import * as packageInfo from "../package.json";
import * as ks from "./keystore";
import * as logger from "./logger";

const coinsToString = (coins: Coin[]): string =>
  coins.map((c) => `${parseFloat(c.amount).toFixed(18)}${c.denom}`).join(",");

/**
 * Calculates the aggregate vote hash
 * @param exchangeRates exchange rates
 * @param salt salt
 * @param validator validator operator address
 */
function aggregateVoteHash(
  exchangeRates: string,
  salt: string,
  validator: string
): string {
  const payload = Buffer.from(`${salt}:${exchangeRates}:${validator}`);
  return toHex(sha256(payload)).substring(0, 40);
}

export function calculateFee(
  gasLimit: number,
  gasPrice: string,
  granter?: string
): StdFee {
  const { denom, amount: gasPriceAmount } = GasPrice.fromString(gasPrice);
  // Note: Amount can exceed the safe integer range (https://github.com/cosmos/cosmjs/issues/1134),
  // which we handle by converting from Decimal to string without going through number.
  const amount = gasPriceAmount
    .multiply(new Uint53(gasLimit))
    .ceil()
    .toString();
  return {
    amount: coins(amount, denom),
    gas: gasLimit.toString(),
    granter: granter || undefined,
  };
}

export async function signAndBroadcast(
  client: SigningStargateClient,
  signerAddress: string,
  args: VoteArgs,
  messages: readonly EncodeObject[],
  memo = ""
): Promise<DeliverTxResponse> {
  const gasEstimation = await client.simulate(signerAddress, messages, memo);
  const multiplier = 1.7;
  const fee = calculateFee(
    Math.round(gasEstimation * multiplier),
    args.gasPrice,
    args.feeGranter
  );

  return client.signAndBroadcast(signerAddress, messages, fee, memo);
}

const ax = axios.create({
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  timeout: 10000,
  headers: {
    post: {
      "Content-Type": "application/json",
    },
  },
});

async function initKey(
  keyPath: string,
  name: string,
  password?: string
): Promise<DirectSecp256k1HdWallet> {
  return ks.load(
    keyPath,
    name,
    password ||
      (await promptly.password(`Enter a passphrase:`, { replace: `*` }))
  );
}

interface OracleParameters {
  oracleVotePeriod: number;
  oracleWhitelist: string[];
  currentVotePeriod: number;
  indexInVotePeriod: number;
  nextBlockHeight: number;
}

async function loadOracleParams(
  client: Tendermint34Client
): Promise<OracleParameters> {
  const kujira = kujiraQueryClient({ client });
  const oracleParams = await kujira.oracle.params();
  const oracleVotePeriod = oracleParams.vote_period;
  const oracleWhitelist: string[] = oracleParams.whitelist.map((e) => e.name);

  const latestBlock = await client.block();

  // the vote will be included in the next block
  const blockHeight = latestBlock.block.header.height;
  const nextBlockHeight = blockHeight + 1;
  const currentVotePeriod = Math.floor(blockHeight / oracleVotePeriod);
  const indexInVotePeriod = nextBlockHeight % oracleVotePeriod;

  return {
    oracleVotePeriod,
    oracleWhitelist,
    currentVotePeriod,
    indexInVotePeriod,
    nextBlockHeight,
  };
}

interface Price {
  denom: string;
  price: string;
}

async function getPrices(sources: string[]): Promise<Price[]> {
  const results = await Bluebird.some(
    sources.map((s) => ax.get(s)),
    1
  ).then((results) =>
    results.filter(({ data }) => {
      if (
        typeof data.created_at !== "string" ||
        !Array.isArray(data.prices) ||
        !data.prices.length
      ) {
        logger.error("getPrices: invalid response");
        return false;
      }

      // Ignore prices older than 60 seconds ago
      if (Date.now() - new Date(data.created_at).getTime() > 60 * 1000) {
        logger.error("getPrices: too old");
        return false;
      }

      return true;
    })
  );

  if (!results.length) {
    return [];
  }

  return results[0].data.prices;
}

/**
 * preparePrices traverses prices array for following logics:
 * 1. Removes price that cannot be found in oracle whitelist
 * 2. Fill abstain prices for prices that cannot be found in price source but in oracle whitelist
 */
function preparePrices(prices: Price[], oracleWhitelist: string[]): Coin[] {
  return prices
    .filter((p) => oracleWhitelist.includes(p.denom))
    .map((p) => ({ amount: p.price, denom: p.denom }));
}

function buildVoteMsgs(
  prices: Coin[],
  valAddrs: string[],
  voterAddr: string
): MsgAggregateExchangeRateVote[] {
  return valAddrs.map((valAddr) => ({
    salt: crypto.randomBytes(32).toString("hex"),
    exchange_rates: coinsToString(prices),
    feeder: voterAddr,
    validator: valAddr,
  }));
}

let previousVoteMsgs: MsgAggregateExchangeRateVote[] = [];
let previousVotePeriod = 0;

// yarn start vote command
export async function processVote(
  client: Tendermint34Client,
  wallet: DirectSecp256k1HdWallet,
  args: VoteArgs,
  valAddrs: string[]
): Promise<void> {
  logger.info(`[VOTE] Requesting on chain data`);
  const {
    oracleVotePeriod,
    oracleWhitelist,
    currentVotePeriod,
    indexInVotePeriod,
    nextBlockHeight,
  } = await loadOracleParams(client);
  const [account] = await wallet.getAccounts();

  // Skip until new voting period
  // Skip when index [0, oracleVotePeriod - 1] is bigger than oracleVotePeriod - 2 or index is 0
  if (
    (previousVotePeriod && currentVotePeriod === previousVotePeriod) ||
    oracleVotePeriod - indexInVotePeriod < 2
  ) {
    return;
  }

  // If it failed to reveal the price,
  // reset the state by throwing error
  if (previousVotePeriod && currentVotePeriod - previousVotePeriod !== 1) {
    throw new Error("Failed to Reveal Exchange Rates; reset to prevote");
  }

  // Print timestamp before start
  logger.info(
    `[VOTE] Requesting prices from price server ${args.dataSourceUrl.join(",")}`
  );
  const _prices = await getPrices(args.dataSourceUrl);

  // Removes non-whitelisted currencies and abstain for not fetched currencies
  const prices = preparePrices(_prices, oracleWhitelist);

  // Build Exchange Rate Vote Msgs
  const voteMsgs = buildVoteMsgs(prices, valAddrs, account.address);

  logger.info(`[VOTE] Create transaction and sign`);
  // Build Exchange Rate Prevote Msgs
  const isPrevoteOnlyTx = previousVoteMsgs.length === 0;
  const msgs = [
    ...previousVoteMsgs.map(msg.oracle.msgAggregateExchangeRateVote),
    ...voteMsgs.map((vm) =>
      msg.oracle.msgAggregateExchangeRatePrevote({
        hash: aggregateVoteHash(vm.exchange_rates, vm.salt, vm.validator),
        feeder: vm.feeder,
        validator: vm.validator,
      })
    ),
  ];
  logger.info(`[PREVOTE] msg: ${JSON.stringify(msgs)}\n`);

  const signer = await SigningStargateClient.connectWithSigner(
    args.rpcUrl,
    wallet,
    {
      registry,
    }
  );
  const res: DeliverTxResponse = await signAndBroadcast(
    signer,
    account.address,
    args,
    msgs,
    `${packageInfo.name}@${packageInfo.version}`
  )
    .then((res) => {
      assertIsDeliverTxSuccess(res);
      return res;
    })
    .catch((err) => {
      logger.error(`broadcast error: ${err.message}`);
      throw err;
    });

  const txhash = res.transactionHash;
  logger.info(`[VOTE] Broadcast success ${txhash}`);

  const height = await validateTx(
    client,
    nextBlockHeight,
    txhash,
    args,
    // if only prevote exist, then wait 2 * vote_period blocks,
    // else wait left blocks in the current vote_period
    isPrevoteOnlyTx
      ? oracleVotePeriod * 2
      : oracleVotePeriod - indexInVotePeriod
  );

  // Update last success VotePeriod
  previousVotePeriod = Math.floor(height / oracleVotePeriod);
  previousVoteMsgs = voteMsgs;
}

async function validateTx(
  client: Tendermint34Client,
  nextBlockHeight: number,
  txhash: string,
  args: VoteArgs,
  timeoutHeight: number
): Promise<number> {
  let inclusionHeight = 0;

  // wait 3 blocks
  const maxBlockHeight = nextBlockHeight + timeoutHeight;

  // current block height
  let lastCheckHeight = nextBlockHeight - 1;

  while (!inclusionHeight && lastCheckHeight < maxBlockHeight) {
    await Bluebird.delay(1500);

    const lastBlock = await client.block();
    const latestBlockHeight = lastBlock.block.header.height;

    if (latestBlockHeight <= lastCheckHeight) {
      continue;
    }

    // set last check height to latest block height
    lastCheckHeight = latestBlockHeight;

    // wait for indexing (not sure; but just for safety)
    await Bluebird.delay(500);

    // FIX-ME: replace this rest request with a station.js request. At the moment
    // station.js does not accept custom models which means that it will fail
    // parsing the /oracle.oracle.MsgAggregateExchangeRatePrevote and as a
    // consequence will not return the height which is the parameter we need
    // to operate on.
    await kujiraQueryClient({ client })
      .tx.getTx(txhash)
      .then((res) => {
        if (!res.txResponse) throw new Error("No txResponse");
        const { height, code, rawLog } = res.txResponse;

        if (!code) {
          inclusionHeight = height.toNumber();
        } else {
          throw new Error(
            `[VOTE]: transaction failed tx: code: ${code}, raw_log: ${rawLog}`
          );
        }
      });
  }

  if (!inclusionHeight) {
    throw new Error("[VOTE]: transaction timeout");
  }

  logger.info(`[VOTE] Included at height: ${inclusionHeight}`);
  return inclusionHeight;
}

interface VoteArgs {
  rpcUrl: string;
  prefix: string;
  chainID: string;
  gasPrice: string;
  feeGranter?: string;
  validators: string[];
  dataSourceUrl: string[];
  password: string;
  keyPath: string;
  keyName: string;
}

export async function vote(args: VoteArgs): Promise<void> {
  const wallet = await initKey(args.keyPath, args.keyName, args.password);
  const valAddrs: string[] = args.validators;
  const tmClient = await Tendermint34Client.connect(args.rpcUrl);

  while (true) {
    const startTime = Date.now();

    await processVote(tmClient, wallet, args, valAddrs).catch((err) => {
      logger.error(err);
      resetPrevote();
    });

    await Bluebird.delay(Math.max(500, 500 - (Date.now() - startTime)));
  }
}

function resetPrevote() {
  previousVotePeriod = 0;
  previousVoteMsgs = [];
}
