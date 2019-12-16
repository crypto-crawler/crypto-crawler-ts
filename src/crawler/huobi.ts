import { strict as assert } from 'assert';
import WebSocket from 'ws';
import Pako from 'pako';
import getExchangeInfo, { ExchangeInfo } from 'exchange-info';
import { getChannels, buildPairMap } from './util';
import createLogger from '../util/logger';
import { OrderBookMsg, TradeMsg, BboMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

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
      throw Error(`ChannelType ${channeltype} is not supported for Binance yet`);
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
  const logger = createLogger(EXCHANGE_NAME);
  const exchangeInfo = await getExchangeInfo(EXCHANGE_NAME);
  assert.equal(exchangeInfo.name, EXCHANGE_NAME);
  // raw_pair -> pairInfo
  const pairMap = buildPairMap(exchangeInfo.pairs);
  // empty means all pairs
  if (pairs.length === 0) {
    pairs = Object.keys(exchangeInfo.pairs); // eslint-disable-line no-param-reassign
  }
  logger.info(pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);
  const websocket = new WebSocket(exchangeInfo.websocket_endpoint);

  websocket.on('open', () => {
    logger.info(`${websocket.url} connected`);
    channels.forEach(channel => {
      websocket.send(JSON.stringify({ sub: channel, id: 'crypto-crawler' }));
    });
  });
  websocket.on('message', data => {
    const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
    const obj = JSON.parse(raw);
    if (obj.ping) {
      websocket.send(JSON.stringify({ pong: obj.ping }));
    } else if (obj.tick) {
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
              trade_id: x.id, // TODO: bignumber
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
    } else {
      logger.warn(obj);
    }
  });
  websocket.on('error', error => {
    logger.error(JSON.stringify(error));
    process.exit(1); // fail fast, pm2 will restart it
  });
  websocket.on('close', () => {
    logger.info(`${websocket.url} disconnected`);
    process.exit(); // pm2 will restart it
  });
}
