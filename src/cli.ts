#!/usr/bin/env node
/* eslint-disable no-console,camelcase */
import yargs from 'yargs';
import chalk from 'chalk';
import figlet from 'figlet';

import { NewdexCrawler, CrawlType } from './crawler';

const { argv } = yargs.options({
  exchange: {
    choices: ['newdex', 'binance', 'huobi'],
    type: 'string',
    demandOption: true,
    default: 'newdex',
  },
  crawl_type: {
    choices: ['ORDER_BOOK', 'TRADE', 'TICKER'],
    type: 'string',
    demandOption: true,
    default: 'ORDER_BOOK',
  },
  pair: {
    choices: ['EIDOS_EOS', 'BTC_USDT', 'ETH_BTC'],
    type: 'string',
    demandOption: true,
    default: 'EIDOS_EOS',
  },
});

console.info(chalk.green(figlet.textSync('Crypto Crawler')));

const { exchange, crawl_type, pair } = argv;

let crawler;

switch (exchange) {
  case 'newdex':
    crawler = new NewdexCrawler([(CrawlType as any)[crawl_type]], [pair]);
    break;
  default:
    throw Error(`Unsupported exchange: ${argv.exchange}`);
}

crawler.start();
