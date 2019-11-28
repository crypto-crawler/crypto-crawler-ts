#!/usr/bin/env node
/* eslint-disable no-console */
import yargs from 'yargs';
import chalk from 'chalk';
import figlet from 'figlet';
import { ChannelType, EXCHANGES, CHANNEL_TYPES, SupportedExchange } from './crawler';

import crawl from './index';

const { argv } = yargs.options({
  exchange: {
    choices: EXCHANGES,
    type: 'string',
    demandOption: true,
    default: 'Newdex',
  },
  channel_type: {
    choices: CHANNEL_TYPES,
    type: 'string',
    demandOption: true,
    default: 'OrderBook',
  },
  pair: {
    type: 'string',
    demandOption: true,
    default: 'EIDOS_EOS',
  },
});

console.info(chalk.green(figlet.textSync('Crypto Crawler')));

const { exchange, channel_type, pair } = argv;

(async () => {
  await crawl(exchange as SupportedExchange, [channel_type as ChannelType], [pair]);
})();
