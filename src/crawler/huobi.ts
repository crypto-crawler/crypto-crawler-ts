import { strict as assert } from 'assert';
import { ExchangeInfo } from 'exchange-info';
import Pako from 'pako';
import { BboMsg, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { ChannelType, defaultMsgCallback, MsgCallback } from './index';
import { connect, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Huobi';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  const pairInfo = exchangeInfo.pairs[pair];
  const rawPair = pairInfo.raw_pair.toLowerCase();
  switch (channeltype) {
    case 'BBO':
      return `market.${rawPair}.bbo`;
    case 'FullOrderBook':
      return `market.${rawPair}.depth.step0`;
    case 'Trade':
      return `market.${rawPair}.trade.detail`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes(''));
  const suffix = channel.split('.')[2];
  let result: ChannelType;
  switch (suffix) {
    case 'bbo':
      result = 'BBO';
      break;
    case 'depth':
      result = 'FullOrderBook';
      break;
    case 'trade':
      result = 'Trade';
      break;
    default:
      throw Error(`Unknown channel: ${channel}`);
  }
  return result;
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo, pairMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);

  connect(
    exchangeInfo.websocket_endpoint,
    data => {
      const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (!obj.tick) {
        if (obj.status === 'ok') logger.info(obj);
        else logger.warn(obj);
        return;
      }
      if (obj.ts && obj.ch && obj.tick) {
        const rawMsg = obj as { ch: string; ts: number; tick: { [key: string]: any } };
        const channelType = getChannelType(rawMsg.ch);
        switch (channelType) {
          case 'BBO': {
            const rawBboMsg = rawMsg.tick as {
              symbol: string;
              quoteTime: string;
              bid: string;
              bidSize: string;
              ask: string;
              askSize: string;
            };
            const bboMsg: BboMsg = {
              exchange: exchangeInfo.name,
              channel: rawMsg.ch,
              pair: pairMap.get(rawBboMsg.symbol)!.normalized_pair,
              timestamp: rawMsg.ts,
              raw,
              bidPrice: parseFloat(rawBboMsg.bid),
              bidQuantity: parseFloat(rawBboMsg.bidSize),
              askPrice: parseFloat(rawBboMsg.ask),
              askQuantity: parseFloat(rawBboMsg.askSize),
            };
            msgCallback(bboMsg);
            break;
          }
          case 'FullOrderBook': {
            const rawFullOrderBookMsg = rawMsg.tick as {
              bids: number[][];
              asks: number[][];
              version: number;
              ts: number;
            };
            const orderBookMsg: OrderBookMsg = {
              exchange: exchangeInfo.name,
              channel: rawMsg.ch,
              pair: pairMap.get(rawMsg.ch.split('.')[1])!.normalized_pair,
              timestamp: rawMsg.ts,
              raw,
              asks: [],
              bids: [],
              full: true,
            };
            orderBookMsg.asks = rawFullOrderBookMsg.asks.map(x => ({
              price: x[0],
              quantity: x[1],
              cost: x[0] * x[1],
            }));
            orderBookMsg.bids = rawFullOrderBookMsg.bids.map(x => ({
              price: x[0],
              quantity: x[1],
              cost: x[0] * x[1],
            }));
            msgCallback(orderBookMsg);
            break;
          }
          case 'Trade': {
            const rawTradeMsg = rawMsg.tick as {
              id: number;
              ts: number;
              data: Array<{
                amount: number;
                ts: number;
                id: number;
                tradeId: number;
                price: number;
                direction: 'buy' | 'sell';
              }>;
            };
            const tradeMsges: TradeMsg[] = rawTradeMsg.data.map(x => ({
              exchange: exchangeInfo.name,
              channel: rawMsg.ch,
              pair: pairMap.get(rawMsg.ch.split('.')[1])!.normalized_pair,
              timestamp: x.ts,
              raw: JSON.stringify(x),
              price: x.price,
              quantity: x.amount,
              side: x.direction === 'sell',
              trade_id: x.id.toString(), // TODO: bignumber
            }));

            tradeMsges.forEach(async tradeMsg => msgCallback(tradeMsg));
            break;
          }
          default:
            logger.error(`Unknown channel: ${obj.ch}`);
        }
      } else {
        logger.warn(obj);
      }
    },
    channels.map(channel => ({ sub: channel, id: 'crypto-crawler' })),
    logger,
  );
}
