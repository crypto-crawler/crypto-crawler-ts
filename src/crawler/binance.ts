import { strict as assert } from 'assert';
import WebSocket from 'ws';
import getExchangeInfo, { ExchangeInfo } from 'exchange-info';
import { listenWebSocket, getChannels, buildPairMap } from './util';
import createLogger from '../util/logger';
import { OrderItem, OrderBookMsg, TradeMsg, BboMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  const pairInfo = exchangeInfo.pairs[pair];
  const rawPair = pairInfo.raw_pair.toLowerCase();
  switch (channeltype) {
    case 'BBO':
      return `${rawPair}@bookTicker`;
    case 'OrderBookUpdate':
      return `${rawPair}@depth`;
    case 'Trade':
      return `${rawPair}@trade`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for Binance yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes('@'));
  const suffix = channel.split('@')[1];
  let result: ChannelType;
  switch (suffix) {
    case 'bookTicker':
      result = 'BBO';
      break;
    case 'depth':
      result = 'OrderBookUpdate';
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
  const logger = createLogger('Binance');
  const exchangeInfo = await getExchangeInfo('Binance');
  // raw_pair -> pairInfo
  const pairMap = buildPairMap(exchangeInfo.pairs);
  // empty means all pairs
  if (pairs.length === 0) {
    pairs = Object.keys(exchangeInfo.pairs); // eslint-disable-line no-param-reassign
  }
  logger.info(pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);
  const websocketUrl = `${exchangeInfo.websocket_endpoint}/stream?streams=${channels.join('/')}`;
  const websocket = new WebSocket(websocketUrl);
  listenWebSocket(
    websocket,
    async data => {
      const rawMsg: { stream: string; data: { [key: string]: any } } = JSON.parse(data as string);
      const channelType = getChannelType(rawMsg.stream);
      switch (channelType) {
        case 'BBO': {
          const rawBookTickerMsg = rawMsg.data as {
            u: number; // order book updateId
            s: string; // symbol
            b: string; // best bid price
            B: string; // best bid qty
            a: string; // best ask price
            A: string; // best ask qty
          };
          const msg: BboMsg = {
            exchange: exchangeInfo.name,
            channel: rawMsg.stream,
            pair: pairMap.get(rawBookTickerMsg.s)!.normalized_pair,
            timestamp: Date.now(),
            raw: data as string,
            bidPrice: parseFloat(rawBookTickerMsg.b),
            bidQuantity: parseFloat(rawBookTickerMsg.B),
            askPrice: parseFloat(rawBookTickerMsg.a),
            askQuantity: parseFloat(rawBookTickerMsg.A),
          };
          await msgCallback(msg);
          break;
        }
        case 'OrderBookUpdate': {
          const rawOrderbookMsg = rawMsg.data as {
            e: string;
            E: number;
            s: string;
            U: number;
            u: number;
            b: Array<Array<string>>;
            a: Array<Array<string>>;
          };
          assert.equal(rawOrderbookMsg.e, 'depthUpdate');
          const msg: OrderBookMsg = {
            exchange: exchangeInfo.name,
            channel: rawMsg.stream,
            pair: pairMap.get(rawOrderbookMsg.s)!.normalized_pair,
            timestamp: rawOrderbookMsg.E,
            raw: data as string,
            asks: [],
            bids: [],
            full: false,
          };
          const parseOrder = (arr: Array<string>): OrderItem => {
            assert.equal(arr.length, 2);
            const orderItem: OrderItem = {
              price: parseFloat(arr[0]),
              quantity: parseFloat(arr[1]),
              cost: 0,
            };
            orderItem.cost = orderItem.price * orderItem.quantity;
            return orderItem;
          };
          rawOrderbookMsg.a.forEach((text: Array<string>) => {
            msg.asks.push(parseOrder(text));
          });
          rawOrderbookMsg.b.forEach((text: Array<string>) => {
            msg.bids.push(parseOrder(text));
          });
          await msgCallback(msg);
          break;
        }
        case 'Trade': {
          const rawTradeMsg = rawMsg.data as {
            e: string;
            E: number;
            s: string;
            t: number;
            p: string;
            q: string;
            b: number;
            a: number;
            T: number;
            m: boolean;
            M: boolean;
          };
          assert.equal(rawTradeMsg.e, 'trade');
          const msg: TradeMsg = {
            exchange: exchangeInfo.name,
            channel: rawMsg.stream,
            pair: pairMap.get(rawTradeMsg.s)!.normalized_pair,
            timestamp: rawTradeMsg.T,
            raw: data as string,
            price: parseFloat(rawTradeMsg.p),
            quantity: parseFloat(rawTradeMsg.q),
            side: rawTradeMsg.m === false,
            trade_id: rawTradeMsg.t,
          };
          await msgCallback(msg);
          break;
        }
        default:
          logger.warn(`Unrecognized CrawlType: ${channelType}`);
          logger.warn(rawMsg);
      }
    },
    logger,
  );
}
