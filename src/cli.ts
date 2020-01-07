#!/usr/bin/env node
/* eslint-disable no-console */
import chalk from 'chalk';
import figlet from 'figlet';
import yargs from 'yargs';
import { ChannelType, CHANNEL_TYPES, EXCHANGES } from './crawler';
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
  pairs: {
    type: 'array',
    demandOption: true,
    default: ['BTC_USDT'],
  },
});

console.info(chalk.green(figlet.textSync('Crypto Crawler')));

const { exchange, channel_type, pairs } = argv;

(async () => {
  await crawl(exchange, [channel_type as ChannelType], pairs);
})();
