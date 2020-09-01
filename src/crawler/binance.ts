import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { ChannelType } from '../pojo/channel_type';
import {
  BboMsg,
  FundingRateMsg,
  KlineMsg,
  OrderBookMsg,
  OrderItem,
  TickerMsg,
  TradeMsg,
} from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, debug, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Binance';

const PERIOD_NAMES: { [key: string]: string } = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  // '1h': '1H',
  // '2h': '2H',
  // '4h': '4H',
  // '6h': '6H',
  // '8h': '8H',
  // '12h': '12H',
  // '1d': '1D',
  // '3d': '3D',
  // '1w': '1W',
  // '1M': '1M',
};

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
    case 'FundingRate':
      assert.equal(marketType, 'Swap');
      return [`${rawPair}@markPrice`];
    case 'Kline':
      return Object.keys(PERIOD_NAMES).map((x) => `${rawPair}@kline_${x}`);
    case 'OrderBook':
      return [`${rawPair}@depth`];
    case 'Ticker':
      return [`${rawPair}@ticker`];
    case 'Trade':
      return [`${rawPair}@aggTrade`]; // trade or aggTrade
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes('@'));
  const suffix = channel.split('@')[1];

  if (suffix.startsWith('kline_')) return 'Kline';

  switch (suffix) {
    case 'bookTicker':
      return 'BBO';
    case 'markPrice':
      return 'FundingRate';
    case 'depth':
      return 'OrderBook';
    // case 'kline_1m':
    //   return 'Kline';
    case 'ticker':
      return 'Ticker';
    case 'trade':
      return 'Trade';
    case 'aggTrade':
      return 'Trade';
    default:
      throw Error(`Unknown channel: ${channel}`);
  }
}

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.ok(['Spot', 'Swap'].includes(marketType), 'Binance has only Spot and Swap markets');

  const [markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  if (!channelTypes.includes('Kline')) {
    assert.equal(channels.length, channelTypes.length * pairs.length);
  }

  const websocketUrl = `${WEBSOCKET_ENDPOINTS[marketType]}/stream?streams=${channels.join('/')}`;

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
            raw: rawMsg,
            bidPrice: parseFloat(rawBookTickerMsg.b),
            bidQuantity: parseFloat(rawBookTickerMsg.B),
            askPrice: parseFloat(rawBookTickerMsg.a),
            askQuantity: parseFloat(rawBookTickerMsg.A),
          };

          msgCallback(msg);
          break;
        }
        case 'FundingRate': {
          const rawFundingRateMsg = rawMsg.data as {
            e: string;
            E: number;
            s: string;
            p: string;
            r: string;
            T: number;
          };
          assert.equal(rawFundingRateMsg.e, 'markPriceUpdate');
          const fundingRateMsg: FundingRateMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawFundingRateMsg.s)!.pair,
            rawPair: rawFundingRateMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: rawFundingRateMsg.E,
            raw: rawFundingRateMsg,
            fundingRate: parseFloat(rawFundingRateMsg.r),
            fundingTime: rawFundingRateMsg.T,
          };

          msgCallback(fundingRateMsg);
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

          msgCallback(msg);
          break;
        }
        case 'Kline': {
          const rawKlineMsg = rawMsg.data as {
            e: string; // Event type
            E: number; // Event time
            s: string; // Symbol
            k: {
              t: number; // Kline start time
              T: number; // Kline close time
              s: string; // Symbol
              i: string; // Interval
              f: number; // First trade ID
              L: number; // Last trade ID
              o: string; // Open price
              c: string; // Close price
              h: string; // High price
              l: string; // Low price
              v: string; // Base asset volume
              n: number; // Number of trades
              x: boolean; // Is this kline closed?
              q: string; // Quote asset volume
              V: string; // Taker buy base asset volume
              Q: string; // Taker buy quote asset volume
              B: string; // Ignore
            };
          };

          const klineMsg: KlineMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawKlineMsg.s)!.pair,
            rawPair: rawKlineMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: rawKlineMsg.k.t,
            raw: rawKlineMsg,
            open: parseFloat(rawKlineMsg.k.o),
            high: parseFloat(rawKlineMsg.k.h),
            low: parseFloat(rawKlineMsg.k.l),
            close: parseFloat(rawKlineMsg.k.c),
            volume: parseFloat(rawKlineMsg.k.v),
            quoteVolume: parseFloat(rawKlineMsg.k.q),
            period: PERIOD_NAMES[rawKlineMsg.k.i],
          };

          msgCallback(klineMsg);
          break;
        }
        case 'Ticker': {
          const rawTickerMsg = rawMsg.data as {
            e: string; // Event type
            E: number; // Event time
            s: string; // Symbol
            p: string; // Price change
            P: string; // Price change percent
            w: string; // Weighted average price
            x: string; // First trade(F)-1 price (first trade before the 24hr rolling window)
            c: string; // Last price
            Q: string; // Last quantity
            b: string; // Best bid price
            B: string; // Best bid quantity
            a: string; // Best ask price
            A: string; // Best ask quantity
            o: string; // Open price
            h: string; // High price
            l: string; // Low price
            v: string; // Total traded base asset volume
            q: string; // Total traded quote asset volume
            O: number; // Statistics open time
            C: number; // Statistics close time
            F: number; // First trade ID
            L: number; // Last trade Id
            n: number; // Total number of trades
          };

          const tickerMsg: TickerMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawTickerMsg.s)!.pair,
            rawPair: rawTickerMsg.s,
            channel: rawMsg.stream,
            channelType,
            timestamp: rawTickerMsg.E,
            raw: rawTickerMsg,
            last_quantity: parseFloat(rawTickerMsg.Q),

            open: parseFloat(rawTickerMsg.o),
            high: parseFloat(rawTickerMsg.h),
            low: parseFloat(rawTickerMsg.l),
            close: parseFloat(rawTickerMsg.c),
            volume: parseFloat(rawTickerMsg.v),
            quoteVolume: parseFloat(rawTickerMsg.q),
          };

          if (marketType === 'Spot') {
            Object.assign(tickerMsg, {
              best_bid_price: parseFloat(rawTickerMsg.b),
              best_bid_quantity: parseFloat(rawTickerMsg.B),
              best_ask_price: parseFloat(rawTickerMsg.a),
              best_ask_quantity: parseFloat(rawTickerMsg.A),
            });
          }

          msgCallback(tickerMsg);
          break;
        }
        case 'Trade': {
          if (rawMsg.stream.split('@')[1] === 'trade') {
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

            msgCallback(msg);
          } else {
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

            msgCallback(msg);
          }

          break;
        }
        default:
          debug(`Unrecognized CrawlType: ${channelType}`);
          debug(rawMsg);
      }
    },
    undefined,
  );
}
