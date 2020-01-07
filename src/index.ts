import { ChannelType, defaultMsgCallback, MsgCallback } from './crawler';
import crawlBinance from './crawler/binance';
import crawlBitfinex from './crawler/bitfinex';
import crawlBitstamp from './crawler/bitstamp';
import crawlCoinbase from './crawler/coinbase';
import crawlHuobi from './crawler/huobi';
import crawlKraken from './crawler/kraken';
import crawlNewdex from './crawler/newdex';
import crawlOKExSpot from './crawler/okex_spot';
import crawlWhaleEx from './crawler/whaleex';

/**
 * Crawl messages from a crypto exchange.
 *
 * @export
 * @param {string} exchange The crypto exchange name
 * @param {ChannelType[]} channelTypes types of channels you want to crawl
 * @param {string[]} [pairs=[]] pairs you want to crawl
 * @param {ProcessMessageCallback} [processMsgCallback=defaultProcessMessageCallback] the callback to process messages
 * @returns {Promise<void>}
 */
export default async function crawl(
  exchange: string,
  channelTypes: ChannelType[],
  pairs: string[] = [], // empty means all
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  if (pairs.length > 0) {
    pairs = Array.from(new Set(pairs)); // eslint-disable-line no-param-reassign
  }

  switch (exchange) {
    case 'Binance':
      return crawlBinance(channelTypes, pairs, msgCallback);
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

export { ChannelType, MsgCallback } from './crawler';
export * from './pojo/msg';
