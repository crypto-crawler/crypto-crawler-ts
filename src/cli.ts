#!/usr/bin/env node
/* eslint-disable no-console */
import yargs from 'yargs';
import chalk from 'chalk';
import figlet from 'figlet';

import NewdexCrawler from './crawler/newdex_crawler';
import { Msg } from './pojo/msg';
import ChannelType from './crawler/crawl_type';

const { argv } = yargs.options({
  exchange: { choices: ['newdex', 'binance', 'huobi'], demandOption: true },
});

console.info(chalk.green(figlet.textSync('Crypto Crawler')));

async function callback(msg: Msg): Promise<Boolean> {
  console.dir(msg);
  return true;
}

let crawler;

switch (argv.exchange) {
  case 'newdex':
    crawler = new NewdexCrawler(callback, [ChannelType.ORDER_BOOK], ['EIDOS/EOS']);
    break;
  default:
    throw Error(`Unsupported exchange: ${argv.exchange}`);
}

crawler.start();
