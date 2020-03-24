#!/usr/bin/env node
/* eslint-disable no-console */
import chalk from 'chalk';
import { MarketType, MARKET_TYPES } from 'crypto-markets';
import figlet from 'figlet';
import yargs from 'yargs';
import { EXCHANGES } from './crawler';
import crawl from './index';
import { ChannelType, CHANNEL_TYPES } from './pojo/channel_type';

const { argv } = yargs.options({
  exchange: {
    choices: EXCHANGES,
    type: 'string',
    demandOption: true,
    default: 'Binance',
  },
  marketType: {
    choices: MARKET_TYPES,
    type: 'string',
    default: 'Spot',
  },
  channelType: {
    choices: CHANNEL_TYPES,
    type: 'string',
    default: 'OrderBook',
  },
  pairs: {
    type: 'array',
    default: ['BTC_USDT'],
  },
});

console.info(chalk.green(figlet.textSync('Crypto Crawler')));

const { exchange, marketType, channelType, pairs } = argv;

(async (): Promise<void> => {
  await crawl(exchange, marketType as MarketType, [channelType as ChannelType], pairs);
})();
