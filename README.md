# Terra Oracle Feeder

This contains the Oracle feeder software that is used for periodically submitting oracle votes for the exchange rate of the different assets offered by the oracle chain. This implementation can be used as-is, but also can serve as a reference for creating your own custom oracle feeder.

## Overview

This solution has 2 components:

1. [`price-server`](price-server/)

   - Obtain information from various data sources (exchanges, forex data, etc),
   - Model the data,
   - Enable a url to query the data,

2. [`feeder`](feeder/)

   - Reads the exchange rates data from a data source (`price-server`)
   - Periodically submits vote and prevote messages following the oracle voting procedure

## Prerequisites

- Install [Node.js version 18 or greater](https://nodejs.org/)

## Instructions

1. Clone this repository

```sh
git clone https://github.com/terra-money/oracle-feeder
cd oracle-feeder
```

2. Configure and launch `price-server`, following instructions [here](price-server/).

```sh
cd price-server
npm install

# Copy sample config file
cp ./config/default-sample.js ./config/default.js

# make edits
vim ./config/default.js

# price is available at `http://127.0.0.1:8532/latest`
npm run start
```

3. Configure and launch `feeder`, following instructions [here](feeder/).

```sh
cd feeder
npm install

# configure to use feeder account
npm start add-key

# start voting
$ npm start vote -- \
   --date-source-url http://localhost:8532/latest \
   --rpc-url https://rpc.harpoon.kujira.setten.io \
   --chain-id harpoon-4 \
   --validators kujiravaloper12345 \
   --password "<password>" \
   --gas-prices 0.00125ukuji \
   --fee-granter kujira1234
```
