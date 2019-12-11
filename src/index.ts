import {
  SupportedExchange,
  ChannelType,
  ProcessMessageCallback,
  defaultProcessMessageCallback,
} from './crawler';
import crawlBinance from './crawler/binance';
import crawlNewdex from './crawler/newdex';
import crawlWhaleEx from './crawler/whaleex';

export * from './pojo/msg';
export { SupportedExchange, ChannelType, ProcessMessageCallback } from './crawler';

/**
 * Crawl messages from a crypto exchange.
 *
 * @export
 * @param {SupportedExchange} exchange The crypto exchange name
 * @param {ChannelType[]} channelTypes types of channels you want to crawl
 * @param {string[]} [pairs=[]] pairs you want to crawl
 * @param {ProcessMessageCallback} [processMsgCallback=defaultProcessMessageCallback] the callback to process messages
 * @returns {Promise<void>}
 */
export default async function crawl(
  exchange: SupportedExchange,
  channelTypes: ChannelType[],
  pairs: string[] = [],
  processMsgCallback: ProcessMessageCallback = defaultProcessMessageCallback,
): Promise<void> {
  if (pairs.length > 0) {
    pairs = Array.from(new Set(pairs)); // eslint-disable-line no-param-reassign
  }

  switch (exchange) {
    case 'Binance':
      return crawlBinance(channelTypes, pairs, processMsgCallback);
    case 'Newdex':
      return crawlNewdex(channelTypes, pairs, processMsgCallback);
    case 'WhaleEx':
      return crawlWhaleEx(channelTypes, pairs, processMsgCallback);
    default:
      throw new Error(`Unknown exchange: ${exchange}`);
  }
}
