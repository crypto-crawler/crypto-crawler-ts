import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import Pako from 'pako';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, KlineMsg, OrderBookMsg, TickerMsg, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { calcQuantity, connect, debug, getChannels, initBeforeCrawl } from './util';

// doc https://huobiapi.github.io/docs/spot/v1/en/

const EXCHANGE_NAME = 'Huobi';

const WEBSOCKET_ENDPOINTS: { [key: string]: string } = {
  Spot: 'wss://api.huobi.pro/ws',
  Futures: 'wss://www.hbdm.com/ws',
  Swap: 'wss://api.hbdm.com/swap-ws',
};

const contractTypes: { [key: string]: string } = {
  this_week: 'CW',
  next_week: 'NW',
  quarter: 'CQ',
};

const PERIOD_NAMES: { [key: string]: string } = {
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '30min': '30m',
  '60min': '1H',
  '4hour': '4H',
  '1day': '1D',
  '1week': '1W',
  '1mon': '1M',
  '1year': '1Y',
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
    assert.equal(market.exchange, EXCHANGE_NAME);
    const rawPair =
      market.type === 'Futures'
        ? `${market.base}_${contractTypes[market.info.contract_type]}`
        : market.id;
    switch (channeltype) {
      case 'BBO':
        return [marketType === 'Spot' ? `market.${rawPair}.bbo` : `market.${rawPair}.depth.step6`];
      case 'Kline':
        return Object.keys(PERIOD_NAMES).map((period) => `market.${rawPair}.kline.${period}`);
      case 'OrderBook':
        return [`market.${rawPair}.depth.step0`];
      case 'Ticker':
        return [`market.${rawPair}.detail`];
      case 'Trade':
        return [`market.${rawPair}.trade.detail`];
      default:
        throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
    }
  });

  return result;
}

function getChannelType(channel: string): ChannelType {
  const suffix = channel.split('.')[2];
  let result: ChannelType;
  switch (suffix) {
    case 'bbo':
      result = 'BBO';
      break;
    case 'depth':
      result = channel.endsWith('step0') ? 'OrderBook' : 'BBO';
      break;
    case 'kline':
      result = 'Kline';
      break;
    case 'trade':
      result = 'Trade';
      break;
    case 'detail':
      result = 'Ticker';
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
  const [markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  if ((marketType === 'Spot' || marketType === 'Swap') && !channelTypes.includes('Kline')) {
    assert.equal(channels.length, channelTypes.length * pairs.length);
  }

  const marketMapFutures = new Map<string, Market>();
  if (marketType === 'Futures') {
    markets
      .filter((x) => x.type === 'Futures')
      .forEach((market) => {
        const rawPair = `${market.base}_${contractTypes[market.info.contract_type]}`;
        marketMapFutures.set(rawPair, market);
      });
  }

  connect(
    WEBSOCKET_ENDPOINTS[marketType],
    (data) => {
      const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (!obj.tick) {
        if (obj.status === 'ok') debug(obj);
        else debug(obj);
        return;
      }
      if (obj.ts && obj.ch && obj.tick) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawMsg = obj as { ch: string; ts: number; tick: { [key: string]: any } };
        const channelType = getChannelType(rawMsg.ch);
        switch (channelType) {
          case 'BBO': {
            if (marketType === 'Spot') {
              const rawBboMsg = rawMsg.tick as {
                symbol: string;
                quoteTime: string;
                bid: string;
                bidSize: string;
                ask: string;
                askSize: string;
              };
              const market = marketMap.get(rawBboMsg.symbol)!;

              const bboMsg: BboMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair: marketMap.get(rawBboMsg.symbol)!.pair,
                rawPair: rawBboMsg.symbol,
                channel: rawMsg.ch,
                channelType,
                timestamp: rawMsg.ts,
                raw: rawMsg,
                bidPrice: parseFloat(rawBboMsg.bid),
                bidQuantity: calcQuantity(
                  market,
                  parseFloat(rawBboMsg.bidSize),
                  parseFloat(rawBboMsg.bid),
                ),
                askPrice: parseFloat(rawBboMsg.ask),
                askQuantity: calcQuantity(
                  market,
                  parseFloat(rawBboMsg.askSize),
                  parseFloat(rawBboMsg.ask),
                ),
              };

              msgCallback(bboMsg);
            } else {
              const rawOrderBookMsg = rawMsg.tick as {
                bids: number[][];
                asks: number[][];
                version: number;
                ts: number;
                seqNum?: number;
                prevSeqNum?: number;
              };
              const rawPair = rawMsg.ch.split('.')[1];
              const market =
                marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;

              const bboMsg: BboMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair: market.pair,
                rawPair: market.id,
                channel: rawMsg.ch,
                channelType,
                timestamp: rawMsg.ts,
                raw: rawMsg,
                bidPrice: rawOrderBookMsg.bids[0][0],
                bidQuantity: calcQuantity(
                  market,
                  rawOrderBookMsg.bids[0][1],
                  rawOrderBookMsg.bids[0][0],
                ),
                askPrice: rawOrderBookMsg.asks[0][0],
                askQuantity: calcQuantity(
                  market,
                  rawOrderBookMsg.asks[0][1],
                  rawOrderBookMsg.asks[0][0],
                ),
              };

              msgCallback(bboMsg);
            }

            break;
          }
          case 'Kline': {
            const rawPair = rawMsg.ch.split('.')[1];
            const market =
              marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;

            if (marketType === 'Spot') {
              const rawKlineMsg = rawMsg.tick as {
                id: number;
                amount: number;
                count: number;
                open: number;
                close: number;
                low: number;
                high: number;
                vol: number;
              };

              const klineMsg: KlineMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair: market.pair,
                rawPair: market.id,
                channel: rawMsg.ch,
                channelType,
                timestamp: rawKlineMsg.id * 1000,
                raw: rawKlineMsg,
                open: rawKlineMsg.open,
                high: rawKlineMsg.high,
                low: rawKlineMsg.low,
                close: rawKlineMsg.close,
                volume: rawKlineMsg.amount,
                quoteVolume: rawKlineMsg.vol,
                period: PERIOD_NAMES[rawMsg.ch.split('.')[3]],
              };

              msgCallback(klineMsg);
            } else {
              const rawKlineMsg = rawMsg.tick as {
                id: number;
                mrid: number;
                vol: number;
                count: number;
                open: number;
                close: number;
                low: number;
                high: number;
                amount: number;
              };

              const klineMsg: KlineMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair: market.pair,
                rawPair: market.id,
                channel: rawMsg.ch,
                channelType,
                timestamp: rawKlineMsg.id * 1000,
                raw: rawKlineMsg,
                open: rawKlineMsg.open,
                high: rawKlineMsg.high,
                low: rawKlineMsg.low,
                close: rawKlineMsg.close,
                volume: rawKlineMsg.amount,
                quoteVolume: rawKlineMsg.vol * (market.base === 'BTC' ? 100 : 10),
                period: PERIOD_NAMES[rawMsg.ch.split('.')[3]],
              };

              msgCallback(klineMsg);
            }
            break;
          }
          case 'OrderBook': {
            const rawOrderBookMsg = rawMsg.tick as {
              bids: number[][];
              asks: number[][];
              version: number;
              ts: number;
              seqNum?: number;
              prevSeqNum?: number;
            };
            const rawPair = rawMsg.ch.split('.')[1];
            const market =
              marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;
            const orderBookMsg: OrderBookMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: rawMsg.ts,
              raw: rawMsg,
              asks: [],
              bids: [],
              full: rawOrderBookMsg.seqNum === undefined,
            };
            const parse = (x: number[]): { price: number; quantity: number; cost: number } => {
              const quantity = calcQuantity(market, x[1], x[0]);
              return {
                price: x[0],
                quantity,
                cost: quantity * x[0],
              };
            };
            orderBookMsg.asks = rawOrderBookMsg.asks.map((x) => parse(x));
            orderBookMsg.bids = rawOrderBookMsg.bids.map((x) => parse(x));
            msgCallback(orderBookMsg);
            break;
          }
          case 'Ticker': {
            const rawTickerMsg = rawMsg.tick as {
              amount: number;
              open: number;
              close: number;
              high: number;
              ts: number;
              id: number;
              count: number;
              low: number;
              vol: number;
            };
            const rawPair = rawMsg.ch.split('.')[1];
            const market =
              marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;
            const tickerMsg: TickerMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: rawMsg.ts,
              raw: rawMsg,
              open: rawTickerMsg.open,
              high: rawTickerMsg.open,
              low: rawTickerMsg.low,
              close: rawTickerMsg.close,
              volume: rawTickerMsg.amount,
              quoteVolume: rawTickerMsg.vol * (market.base === 'BTC' ? 100 : 10),
            };

            msgCallback(tickerMsg);
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
            const rawPair = rawMsg.ch.split('.')[1];
            const market =
              marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;
            const tradeMsges: TradeMsg[] = rawTradeMsg.data.map((x) => ({
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: x.ts,
              raw: x,
              price: x.price,
              quantity: calcQuantity(market, x.amount, x.price),
              side: x.direction === 'sell',
              trade_id: (marketType === 'Spot' ? x.tradeId : x.id).toString(),
            }));

            tradeMsges.forEach((tradeMsg) => msgCallback(tradeMsg));
            break;
          }
          default:
            debug(`Unknown channel: ${obj.ch}`);
        }
      } else {
        debug(obj);
      }
    },
    channels.map((channel) => ({ sub: channel, id: 'crypto-crawler', zip: 1 })),
  );
}

export interface HB10IndexMsg {
  exchange: string;
  timestamp: number;
  id: number;
  channel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  interval: string; // m, minute; H, hour; D, day; W, week; M, month; Y, year
}

// see https://www.huobi.com/zh-cn/markets/hb_index/
export async function crawlHB10(
  msgCallback = async (msg: HB10IndexMsg): Promise<void> => console.info(msg), // eslint-disable-line no-console
): Promise<void> {
  const channels = [
    '1min',
    '5min',
    '15min',
    '30min',
    '60min',
    '4hour',
    '1day',
    '1week',
    '1mon',
  ].map((x) => `market.huobi10.kline.${x}`);

  connect(
    'wss://api.huobiasia.vip/ws',
    (data) => {
      const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);

      if (!obj.tick) {
        if (obj.status === 'ok') debug(obj);
        else debug(obj);
        return;
      }
      if (obj.ts && obj.ch && obj.tick) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawMsg = obj as {
          ch: string;
          ts: number;
          tick: {
            id: number;
            open: number;
            close: number;
            low: number;
            high: number;
            amount: number;
            vol: number;
            count: number;
          };
        };

        assert.equal(rawMsg.tick.amount, 0);
        assert.equal(rawMsg.tick.vol, 0);
        assert.equal(rawMsg.tick.count, 0);

        const hb10IndexMsg: HB10IndexMsg = {
          exchange: 'Huobi',
          timestamp: rawMsg.ts,
          id: rawMsg.tick.id,
          channel: rawMsg.ch,
          open: rawMsg.tick.open,
          high: rawMsg.tick.high,
          low: rawMsg.tick.low,
          close: rawMsg.tick.close,
          interval: PERIOD_NAMES[rawMsg.ch.split('.')[3]],
        };

        msgCallback(hb10IndexMsg);
      }
    },
    channels.map((channel) => ({ sub: channel, id: 'crypto-crawler', zip: 1 })),
  );
}
