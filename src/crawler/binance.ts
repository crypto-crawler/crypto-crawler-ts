import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, getChannelsNew, initBeforeCrawlNew } from './util';

const EXCHANGE_NAME = 'Binance';
const WEBSOCKET_ENDPOINT_SPOT = 'wss://stream.binance.com:9443';
const WEBSOCKET_ENDPOINT_FUTURES = 'wss://fstream.binance.com';

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  const market = markets.filter((x) => x.pair === pair && x.marketType === marketType)[0];
  assert.ok(market, `${EXCHANGE_NAME} Spot market does NOT have ${pair}`);

  const rawPair = market.id.toLowerCase();
  switch (channeltype) {
    case 'BBO':
      return [`${rawPair}@bookTicker`];
    case 'OrderBook':
      return [`${rawPair}@depth`];
    case 'Trade':
      return [`${rawPair}@trade`];
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
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
      result = 'OrderBook';
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
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
  marketType: MarketType = 'Spot',
): Promise<void> {
  assert.ok(['Spot', 'Swap'].includes(marketType), 'Binance has only Spot and Swap markets');

  const [logger, markets, marketMap] = await initBeforeCrawlNew(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannelsNew(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);

  const websocketUrl = `${
    marketType === 'Spot' ? WEBSOCKET_ENDPOINT_SPOT : WEBSOCKET_ENDPOINT_FUTURES
  }/stream?streams=${channels.join('/')}`;

  connect(
    websocketUrl,
    async (data) => {
      const raw = data as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMsg: { stream: string; data: { [key: string]: any } } = JSON.parse(raw);
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
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawBookTickerMsg.s)!.pair,
            rawPair: rawBookTickerMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: Date.now(),
            raw,
            bidPrice: parseFloat(rawBookTickerMsg.b),
            bidQuantity: parseFloat(rawBookTickerMsg.B),
            askPrice: parseFloat(rawBookTickerMsg.a),
            askQuantity: parseFloat(rawBookTickerMsg.A),
          };
          await msgCallback(msg);
          break;
        }
        case 'OrderBook': {
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
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawOrderbookMsg.s)!.pair,
            rawPair: rawOrderbookMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: rawOrderbookMsg.E,
            raw,
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
          msg.asks = rawOrderbookMsg.a.map((text: Array<string>) => parseOrder(text));
          msg.bids = rawOrderbookMsg.b.map((text: Array<string>) => parseOrder(text));
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
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawTradeMsg.s)!.pair,
            rawPair: rawTradeMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: rawTradeMsg.T,
            raw,
            price: parseFloat(rawTradeMsg.p),
            quantity: parseFloat(rawTradeMsg.q),
            side: rawTradeMsg.m === false,
            trade_id: rawTradeMsg.t.toString(),
          };
          await msgCallback(msg);
          break;
        }
        default:
          logger.warn(`Unrecognized CrawlType: ${channelType}`);
          logger.warn(rawMsg);
      }
    },
    undefined,
    logger,
  );
}
