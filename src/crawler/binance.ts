import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Binance';

const WEBSOCKET_ENDPOINTS: { [key: string]: string } = {
  Spot: 'wss://stream.binance.com:9443',
  Swap: 'wss://fstream.binance.com',
};

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  const market = markets.filter((x) => x.pair === pair && x.type === marketType)[0];
  assert.ok(market, `${EXCHANGE_NAME} ${marketType} market does NOT have ${pair}`);
  assert.equal(market.exchange, EXCHANGE_NAME);

  const rawPair = market.id.toLowerCase();
  switch (channeltype) {
    case 'BBO':
      return [`${rawPair}@bookTicker`];
    case 'OrderBook':
      return [`${rawPair}@depth`];
    case 'Trade':
      return [`${rawPair}@aggTrade`]; // trade or aggTrade
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
    case 'aggTrade':
      result = 'Trade';
      break;
    default:
      throw Error(`Unknown channel: ${channel}`);
  }
  return result;
}

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.ok(['Spot', 'Swap'].includes(marketType), 'Binance has only Spot and Swap markets');

  const [logger, markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  assert.equal(channels.length, channelTypes.length * pairs.length);

  const websocketUrl = `${WEBSOCKET_ENDPOINTS[marketType]}/stream?streams=${channels.join('/')}`;

  connect(
    websocketUrl,
    async (data) => {
      const raw = data as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMsg: { stream: string; data: { [key: string]: any } } = JSON.parse(raw);
      const channelType = getChannelType(rawMsg.stream);

      switch (rawMsg.stream.split('@')[1]) {
        case 'bookTicker': {
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
            raw: rawMsg,
            bidPrice: parseFloat(rawBookTickerMsg.b),
            bidQuantity: parseFloat(rawBookTickerMsg.B),
            askPrice: parseFloat(rawBookTickerMsg.a),
            askQuantity: parseFloat(rawBookTickerMsg.A),
          };
          await msgCallback(msg);
          break;
        }
        case 'depth': {
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
            raw: rawMsg,
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
        case 'trade': {
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
            raw: rawMsg,
            price: parseFloat(rawTradeMsg.p),
            quantity: parseFloat(rawTradeMsg.q),
            side: rawTradeMsg.m === false,
            trade_id: rawTradeMsg.t.toString(),
          };
          await msgCallback(msg);
          break;
        }
        case 'aggTrade': {
          const rawTradeMsg = rawMsg.data as {
            e: string; // Event type
            E: number; // Event time
            s: string; // Symbol
            a: number; // Aggregate trade ID
            p: string; // Price
            q: string; // Quantity
            f: number; // First trade ID
            l: number; // Last trade ID
            T: number; // Trade time
            m: boolean; // Is the buyer the market maker?
            M: boolean; // Ignore
          };
          assert.equal(rawTradeMsg.e, 'aggTrade');
          const msg: TradeMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawTradeMsg.s)!.pair,
            rawPair: rawTradeMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: rawTradeMsg.T,
            raw: rawMsg,
            price: parseFloat(rawTradeMsg.p),
            quantity: parseFloat(rawTradeMsg.q),
            side: rawTradeMsg.m === false,
            trade_id: rawTradeMsg.a.toString(),
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
