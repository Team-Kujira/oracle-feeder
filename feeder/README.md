# `feeder`

Submit exchange rate prevotes and votes,

## Requirements

Every Oracle Chain validator must participate in the oracle process and periodically submit a vote for the exchange rate of Luna in all whitelisted denominations. Because this process occurs every 30 seconds, validators must set up an automated process to avoid getting slashed and jailed.

## Make a new key for oracle votes

You can separate the keys used for controlling a validator account from those that are submitting oracle votes on behalf of a validator. Run:

```bash
oracled keys add <feeder>
```

Show the feeder account details:

```bash
oracled keys show <feeder>
```

## Delegate feeder consent

The account address used to submit oracle voting transactions is called a `feeder`. When you set up your oracle voting process for the first time, you must delegate the feeder permission to an account.

```bash
oracled tx oracle set-feeder <feeder-address> --from=<validator>
```

## Instructions

1. Install dependencies

```sh
npm install
```

2. Create a key from your mnemonic

You need the mnemonic phrase for the **feeder account** for your validator.

```sh
npm start add-key

Enter a passphrase to encrypt your key to disk: ********
Repeat the passphrase: ********
Enter your bip39 mnemonic : <some nice mnemonic>
saved!
✨  Done in 9.19s.
```

3. Vote

Make sure the Price Server is running.

You can start feeder with arguments or env.

- Arguments

  ```shell
  $ npm start vote -- \
     --source http://localhost:8532/latest \
     --rpc-url https://lcd-1.anr.dev \
     --chain-id andromeda-oralce-1 \
     --validator kujiravaloper.... \
     --gas-price 0.00125ukuji \
     --fee-granter kujira1234 \
     --password "<password>"
  ```

- Env
  ```shell
  # set your env vars
  $ npm start vote
  ```
