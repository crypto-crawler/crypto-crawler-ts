import { strict as assert } from 'assert';
import fetchMarkets, { Market, MarketType } from 'crypto-markets';
import Pako from 'pako';
import { ChannelType } from '../pojo/channel_type';
import {
  FundingRateMsg,
  KlineMsg,
  OrderBookMsg,
  OrderItem,
  TickerMsg,
  TradeMsg,
} from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import {
  connect,
  convertFullOrderBookMsgToBboMsg,
  debug,
  getChannels,
  initBeforeCrawl,
} from './util';

// doc https://www.okex.com/docs/en/

const EXCHANGE_NAME = 'OKEx';

const WEBSOCKET_ENDPOINT = 'wss://real.okex.com:8443/ws/v3';

const PERIOD_NAMES: { [key: string]: string } = {
  '60': '1m',
  '180': '3m',
  '300': '5m',
  '900': '15m',
  '1800': '30m',
  '3600': '1H',
  '7200': '2H',
  '14400': '4H',
  '21600': '6H',
  '43200': '12H',
  '86400': '1D',
  '604800': '1W',
};

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  const marketsFiltered = markets.filter((x) => x.pair === pair && x.type === marketType);
  assert.ok(
    marketsFiltered.length > 0,
    `${EXCHANGE_NAME} ${marketType} market does NOT have ${pair}`,
  );
  if (marketType === 'Spot') {
    assert.equal(
      marketsFiltered.length,
      1,
      `${EXCHANGE_NAME} ${marketType} market has more than one ${pair}`,
    );
  }

  const result: string[] = marketsFiltered.flatMap((market) => {
    const rawPair = market.id;
    switch (channeltype) {
      case 'BBO':
        return [`${marketType.toLowerCase()}/depth5:${rawPair}`];
      case 'FundingRate':
        assert.equal(marketType, 'Swap');
        return [`${marketType.toLowerCase()}/funding_rate:${rawPair}`];
      case 'Kline':
        return Object.keys(PERIOD_NAMES).map(
          (period) => `${marketType.toLowerCase()}/candle${period}s:${rawPair}`,
        );
      case 'OrderBook':
        return [`${marketType.toLowerCase()}/optimized_depth:${rawPair}`]; // optimized_depth, depth, depth_l2_tbt
      case 'Ticker':
        return [`${marketType.toLowerCase()}/ticker:${rawPair}`];
      case 'Trade':
        return [`${marketType.toLowerCase()}/trade:${rawPair}`];
      default:
        throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
    }
  });

  return result;
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes('/'));
  const channelName = channel.split('/')[1];

  if (channelName.startsWith('candle')) return 'Kline';

  switch (channelName) {
    // case 'candle60s':
    //   return 'Kline';
    case 'depth5':
      return 'BBO';
    case 'funding_rate':
      return 'FundingRate';
    case 'depth_l2_tbt':
    case 'depth':
    case 'optimized_depth':
      return 'OrderBook';
    case 'ticker':
      return 'Ticker';
    case 'trade':
      return 'Trade';
    default:
      throw Error(`Unknown channel: ${channel}`);
  }
}

function calcQuantity(market: Market, size: number, price: number): number {
  if (market.type === 'Spot') {
    return size;
  }
  assert.ok(Number.isInteger(size));

  if (market.quote === 'USDT') {
    // see https://www.okex.com/academy/zh/i-usdt-margin-delivery-contract-introduction-cn
    return size * parseFloat(market.info.contract_val);
  }

  assert.equal(market.quote, 'USD');

  const cost = market.base === 'BTC' ? size * 100 : size * 10;
  return cost / price;
}

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  if ((marketType === 'Spot' || marketType === 'Swap') && !channelTypes.includes('Kline')) {
    assert.equal(channels.length, channelTypes.length * pairs.length);
  }

  connect(
    WEBSOCKET_ENDPOINT,
    async (data) => {
      const raw = Pako.inflateRaw(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (obj.event === 'error') {
        debug(obj);
        process.exit(-1); // fail fast
      } else if (obj.event === 'subscribe') {
        debug(obj);
        return;
      }
      if (!(obj.table && obj.data)) {
        debug(obj);
        return;
      }
      const rawMsg = obj as {
        table: string;
        action?: string;
        data: Array<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      };

      const channelType = getChannelType(rawMsg.table);
      switch (channelType) {
        case 'BBO': {
          const rawOrderBookMsg = rawMsg as {
            table: string;
            data: ReadonlyArray<{
              instrument_id: string;
              asks: Array<[string, string, number]>;
              bids: Array<[string, string, number]>;
              timestamp: string;
            }>;
          };
          assert.equal(rawOrderBookMsg.data.length, 1);
          const market = marketMap.get(rawOrderBookMsg.data[0].instrument_id)!;

          const orderBookMsg: OrderBookMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: market.pair,
            rawPair: rawOrderBookMsg.data[0].instrument_id,
            channel: rawOrderBookMsg.table,
            channelType: 'OrderBook',
            timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
            raw: rawMsg,
            asks: [],
            bids: [],
            full: true,
          };
          const parse = (item: [string, string, number]): OrderItem => {
            const price = parseFloat(item[0]);
            const quantity = calcQuantity(market, parseFloat(item[1]), price);
            return {
              price,
              quantity,
              cost: quantity * price,
            };
          };
          orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map((x) => parse(x));
          orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map((x) => parse(x));

          const bboMsg = convertFullOrderBookMsgToBboMsg(orderBookMsg);
          msgCallback(bboMsg);
          break;
        }
        case 'FundingRate': {
          const rawFundingRateMsg = rawMsg as {
            table: string;
            data: ReadonlyArray<{
              estimated_rate: string;
              funding_rate: string;
              funding_time: string;
              instrument_id: string;
              interest_rate: string;
              settlement_time: string;
            }>;
          };

          rawFundingRateMsg.data.forEach((x) => {
            const market = marketMap.get(x.instrument_id)!;

            const fundingRateMsg: FundingRateMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: x.instrument_id,
              channel: rawFundingRateMsg.table,
              channelType,
              timestamp: Date.now(),
              raw: x,
              fundingRate: parseFloat(x.funding_rate),
              fundingTime: new Date(x.funding_time).getTime(),
            };

            msgCallback(fundingRateMsg);
          });

          break;
        }
        case 'Kline': {
          const rawKlineMsg = rawMsg as {
            table: string;
            data: ReadonlyArray<{
              candle: string[];
              instrument_id: string;
            }>;
          };

          rawKlineMsg.data.forEach((x) => {
            assert.ok(x.candle.length === 6 || x.candle.length === 7);
            const [timestamp, open, high, low, close, volume, currency_volume] = x.candle;

            const market = marketMap.get(x.instrument_id)!;

            const klineMsg: KlineMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: x.instrument_id,
              channel: rawKlineMsg.table,
              channelType,
              timestamp: new Date(timestamp).getTime(),
              raw: x,
              open: parseFloat(open),
              high: parseFloat(high),
              low: parseFloat(low),
              close: parseFloat(close),
              volume: currency_volume ? parseFloat(currency_volume) : parseFloat(volume),
              period: PERIOD_NAMES[parseInt(rawKlineMsg.table.match(/(\d+)/)![0], 10)],
            };

            msgCallback(klineMsg);
          });

          break;
        }
        case 'OrderBook': {
          const rawOrderBookMsg = rawMsg as {
            table: string;
            action: 'partial' | 'update';
            data: ReadonlyArray<{
              instrument_id: string;
              asks: Array<[string, string, number]>;
              bids: Array<[string, string, number]>;
              timestamp: string;
              checksum: number;
            }>;
          };
          assert.equal(rawOrderBookMsg.data.length, 1);
          const market = marketMap.get(rawOrderBookMsg.data[0].instrument_id)!;

          const orderBookMsg: OrderBookMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: market.pair,
            rawPair: rawOrderBookMsg.data[0].instrument_id,
            channel: rawOrderBookMsg.table,
            channelType,
            timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
            raw: rawMsg,
            asks: [],
            bids: [],
            full: rawOrderBookMsg.action === 'partial',
          };
          const parse = (item: [string, string, number]): OrderItem => {
            const price = parseFloat(item[0]);
            const quantity = calcQuantity(market, parseFloat(item[1]), price);
            return {
              price,
              quantity,
              cost: quantity * price,
            };
          };
          orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map((x) => parse(x));
          orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map((x) => parse(x));

          msgCallback(orderBookMsg);
          break;
        }
        case 'Ticker': {
          const rawTickerMsg = rawMsg as {
            table: string;
            data: ReadonlyArray<{
              instrument_id: string;
              last: string;
              last_qty: string;
              best_bid: string;
              best_bid_size: string;
              best_ask: string;
              best_ask_size: string;
              open_24h: string;
              high_24h: string;
              low_24h: string;
              base_volume_24h: string;
              quote_volume_24h: string;
              timestamp: string;
            }>;
          };

          const tickerMsges: TickerMsg[] = rawTickerMsg.data.map((x) => {
            return {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: marketMap.get(x.instrument_id)!.pair,
              rawPair: x.instrument_id,
              channel: rawTickerMsg.table,
              channelType,
              timestamp: new Date(x.timestamp).getTime(),
              raw: x,
              last_quantity: parseFloat(x.last_qty), // TODO: calcQuantity()
              best_bid_price: parseFloat(x.best_bid),
              best_bid_quantity: parseFloat(x.best_bid_size),
              best_ask_price: parseFloat(x.best_ask),
              best_ask_quantity: parseFloat(x.best_ask_size),
              open: parseFloat(x.open_24h),
              high: parseFloat(x.high_24h),
              low: parseFloat(x.low_24h),
              close: parseFloat(x.last),
              volume: parseFloat(x.base_volume_24h),
              quoteVolume: parseFloat(x.quote_volume_24h),
            };
          });

          tickerMsges.forEach((x) => msgCallback(x));
          break;
        }
        case 'Trade': {
          const rawTradeMsg = rawMsg as {
            table: string;
            data: ReadonlyArray<{
              instrument_id: string;
              price: string;
              side: 'buy' | 'sell';
              size: string;
              qty: string;
              timestamp: string;
              trade_id: string;
            }>;
          };

          const tradeMsges: TradeMsg[] = rawTradeMsg.data.map((x) => {
            const market = marketMap.get(x.instrument_id)!;

            return {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: x.instrument_id,
              channel: rawMsg.table,
              channelType,
              timestamp: new Date(x.timestamp).getTime(),
              raw: x,
              price: parseFloat(x.price),
              quantity: calcQuantity(
                market,
                parseFloat(marketType === 'Futures' ? x.qty : x.size),
                parseFloat(x.price),
              ),
              side: x.side === 'sell',
              trade_id: x.trade_id,
            };
          });

          tradeMsges.forEach((x) => msgCallback(x));
          break;
        }
        default:
          debug(`Unknown channel: ${obj.table}`);
      }
    },
    [{ op: 'subscribe', args: channels }],
  );
}

export interface IndexTickerMsg {
  exchange: string;
  pair: string;
  channel: string;
  last: number;
  open_24h: number;
  high_24h: number;
  low_24h: number;
  instrument_id: string;
  timestamp: number;
}

export interface IndexKlineMsg {
  exchange: string;
  pair: string;
  instrument_id: string;
  channel: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base volume
  interval: string; // m, minute; H, hour; D, day; W, week; M, month; Y, year
}

export async function crawlIndex(
  pairs: readonly string[],
  tickerMsgCallback = async (msg: IndexTickerMsg): Promise<void> => console.info(msg), // eslint-disable-line no-console
  klineMsgCallback = async (msg: IndexKlineMsg): Promise<void> => console.info(msg), // eslint-disable-line no-console
): Promise<void> {
  const swapMarkets = (await fetchMarkets('OKEx', 'Swap')).filter(
    (m) => m.active && pairs.includes(m.pair),
  );
  assert.equal(
    pairs.length,
    swapMarkets.length,
    `Some pairs in ${pairs.join(',')} are not in Swap market`,
  );
  const rawPairs = swapMarkets.map((m) => m.id.substring(0, m.id.length - '-SWAP'.length));

  const channelsIndex = rawPairs.map((rawPair) => `index/ticker:${rawPair}`);
  const channelsKline = rawPairs.flatMap((rawPair) =>
    Object.keys(PERIOD_NAMES).map((interval) => `index/candle${interval}s:${rawPair}`),
  );
  const channels = channelsIndex.concat(channelsKline);

  connect(
    WEBSOCKET_ENDPOINT,
    async (data) => {
      const raw = Pako.inflateRaw(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw) as {
        event?: string;
        table: string;
        data: Array<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      };
      if (obj.event === 'error') {
        debug(obj);
        process.exit(-1); // fail fast
      } else if (obj.event === 'subscribe') {
        debug(obj);
        return;
      }
      if (!(obj.table && obj.data)) {
        debug(obj);
        return;
      }

      if (obj.table === 'index/ticker') {
        const arr = obj.data as ReadonlyArray<{
          last: string;
          open_24h: string;
          high_24h: string;
          low_24h: string;
          instrument_id: string;
          timestamp: string;
        }>;
        const tickerMsges: IndexTickerMsg[] = arr.map((x) => ({
          exchange: 'OKEx',
          pair: x.instrument_id.replace('-', '_'),
          channel: obj.table,
          last: parseFloat(x.last),
          open_24h: parseFloat(x.open_24h),
          high_24h: parseFloat(x.high_24h),
          low_24h: parseFloat(x.low_24h),
          instrument_id: x.instrument_id,
          timestamp: new Date(x.timestamp).getTime(),
        }));

        tickerMsges.forEach((x) => tickerMsgCallback(x));
      } else if (obj.table.startsWith('index/candle')) {
        const arr = obj.data as ReadonlyArray<{
          candle: ReadonlyArray<string>;
          instrument_id: string;
        }>;

        const klineMsges: IndexKlineMsg[] = arr.map((x) => ({
          exchange: 'OKEx',
          pair: x.instrument_id.replace('-', '_'),
          instrument_id: x.instrument_id,
          channel: obj.table,
          timestamp: new Date(x.candle[0]).getTime(),
          open: parseFloat(x.candle[1]),
          high: parseFloat(x.candle[2]),
          low: parseFloat(x.candle[3]),
          close: parseFloat(x.candle[4]),
          volume: parseFloat(x.candle[5]),
          interval: PERIOD_NAMES[parseInt(obj.table.match(/(\d+)/)![0], 10)],
        }));

        klineMsges.forEach((x) => klineMsgCallback(x));
      } else {
        debug(`Unknown table: ${obj.table}`);
      }
    },
    [{ op: 'subscribe', args: channels }],
  );
}
