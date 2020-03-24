import { MarketType } from 'crypto-markets';
import { defaultMsgCallback, MsgCallback } from './crawler';
import crawlBinance from './crawler/binance';
import crawlBitfinex from './crawler/bitfinex';
import crawlBitstamp from './crawler/bitstamp';
import crawlCoinbase from './crawler/coinbase';
import crawlHuobi from './crawler/huobi';
import crawlKraken from './crawler/kraken';
import crawlMXC from './crawler/mxc';
import crawlNewdex from './crawler/newdex';
import crawlOKExSpot from './crawler/okex_spot';
import crawlWhaleEx from './crawler/whaleex';
import { ChannelType } from './pojo/channel_type';

/**
 * Crawl messages from a crypto exchange.
 *
 * @param exchange The crypto exchange name
 * @param marketType Market type, e.g., Spot, Futures
 * @param channelTypes Channel types to crawl, e.g., Trade, BBO, OrderBook
 * @param pairs Trading pairs, e.g., BTC_USDT
 * @param msgCallback The callback function to process messages
 * @returns void
 */
export default async function crawl(
  exchange: string,
  marketType: MarketType,
  channelTypes: ChannelType[],
  pairs: string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  if (pairs.length > 0) {
    pairs = Array.from(new Set(pairs)); // eslint-disable-line no-param-reassign
  }

  switch (exchange) {
    case 'Binance':
      return crawlBinance(channelTypes, pairs, msgCallback, marketType);
    case 'Bitfinex':
      return crawlBitfinex(channelTypes, pairs, msgCallback);
    case 'Bitstamp':
      return crawlBitstamp(channelTypes, pairs, msgCallback);
    case 'Coinbase':
      return crawlCoinbase(channelTypes, pairs, msgCallback);
    case 'Huobi':
      return crawlHuobi(channelTypes, pairs, msgCallback);
    case 'Kraken':
      return crawlKraken(channelTypes, pairs, msgCallback);
    case 'MXC':
      return crawlMXC(channelTypes, pairs, msgCallback);
    case 'Newdex':
      return crawlNewdex(channelTypes, pairs, msgCallback);
    case 'OKEx_Spot':
      return crawlOKExSpot(channelTypes, pairs, msgCallback);
    case 'WhaleEx':
      return crawlWhaleEx(channelTypes, pairs, msgCallback);
    default:
      throw new Error(`Unknown exchange: ${exchange}`);
  }
}

export { MsgCallback } from './crawler';
export { ChannelType } from './pojo/channel_type';
export * from './pojo/msg';
