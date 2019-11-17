#!/usr/bin/env node
/* eslint-disable no-console */
import yargs from 'yargs';
import chalk from 'chalk';
import figlet from 'figlet';

import { NewdexCrawler, CrawlType } from './crawler';

const { argv } = yargs.options({
  exchange: { choices: ['newdex', 'binance', 'huobi'], demandOption: true },
});

console.info(chalk.green(figlet.textSync('Crypto Crawler')));

let crawler;

switch (argv.exchange) {
  case 'newdex':
    crawler = new NewdexCrawler([CrawlType.ORDER_BOOK], ['EIDOS/EOS']);
    break;
  default:
    throw Error(`Unsupported exchange: ${argv.exchange}`);
}

crawler.start();
