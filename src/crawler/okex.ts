import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import Pako from 'pako';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem, TickerMsg, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, convertFullOrderBookMsgToBboMsg, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'OKEx';

const WEBSOCKET_ENDPOINT = 'wss://real.okex.com:8443/ws/v3';

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

  const result: string[] = marketsFiltered.map((market) => {
    const rawPair = market.id;
    switch (channeltype) {
      case 'BBO':
        return `${marketType.toLowerCase()}/depth5:${rawPair}`;
      case 'OrderBook':
        return `${marketType.toLowerCase()}/optimized_depth:${rawPair}`; // optimized_depth, depth, depth_l2_tbt
      case 'Ticker':
        return `${marketType.toLowerCase()}/ticker:${rawPair}`;
      case 'Trade':
        return `${marketType.toLowerCase()}/trade:${rawPair}`;
      default:
        throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
    }
  });

  return result;
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes('/'));
  const channelName = channel.split('/')[1];
  let result: ChannelType;
  switch (channelName) {
    case 'depth5':
      return 'BBO';
    case 'depth_l2_tbt':
    case 'depth':
    case 'optimized_depth':
      result = 'OrderBook';
      break;
    case 'ticker':
      result = 'Ticker';
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
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  if (marketType === 'Spot') {
    assert.equal(channels.length, channelTypes.length * pairs.length);
  }

  connect(
    WEBSOCKET_ENDPOINT,
    (data) => {
      const raw = Pako.inflateRaw(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (obj.event === 'error') {
        logger.error(obj);
        process.exit(-1); // fail fast
      } else if (obj.event === 'subscribe') {
        logger.info(obj);
        return;
      }
      if (!(obj.table && obj.data)) {
        logger.warn(obj);
        return;
      }
      const rawMsg = obj as {
        table: string;
        data: Array<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      };

      const channelType = getChannelType(rawMsg.table);
      switch (channelType) {
        case 'BBO': {
          const rawOrderBookMsg = rawMsg as {
            table: string;
            data: [
              {
                instrument_id: string;
                asks: Array<[string, string, number]>;
                bids: Array<[string, string, number]>;
                timestamp: string;
              },
            ];
          };
          assert.equal(rawOrderBookMsg.data.length, 1);
          const orderBookMsg: OrderBookMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawOrderBookMsg.data[0].instrument_id)!.pair,
            rawPair: rawOrderBookMsg.data[0].instrument_id,
            channel: rawOrderBookMsg.table,
            channelType: 'OrderBook',
            timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
            raw: rawMsg,
            asks: [],
            bids: [],
            full: true,
          };
          const parse = (item: [string, string, number]): OrderItem => ({
            price: parseFloat(item[0]),
            quantity: parseFloat(item[1]),
            cost: parseFloat(item[0]) * parseFloat(item[1]),
          });
          orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map((x) => parse(x));
          orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map((x) => parse(x));

          const bboMsg = convertFullOrderBookMsgToBboMsg(orderBookMsg);
          msgCallback(bboMsg);
          break;
        }
        case 'OrderBook': {
          const rawOrderBookMsg = rawMsg as {
            table: string;
            action: 'partial' | 'update';
            data: [
              {
                instrument_id: string;
                asks: Array<[string, string, number]>;
                bids: Array<[string, string, number]>;
                timestamp: string;
                checksum: number;
              },
            ];
          };
          assert.equal(rawOrderBookMsg.data.length, 1);
          const orderBookMsg: OrderBookMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(rawOrderBookMsg.data[0].instrument_id)!.pair,
            rawPair: rawOrderBookMsg.data[0].instrument_id,
            channel: rawOrderBookMsg.table,
            channelType,
            timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
            raw: rawMsg,
            asks: [],
            bids: [],
            full: rawOrderBookMsg.action === 'partial',
          };
          const parse = (item: [string, string, number]): OrderItem => ({
            price: parseFloat(item[0]),
            quantity: parseFloat(item[1]),
            cost: parseFloat(item[0]) * parseFloat(item[1]),
          });
          orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map((x) => parse(x));
          orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map((x) => parse(x));

          msgCallback(orderBookMsg);
          break;
        }
        case 'Ticker': {
          const rawTickerMsg = rawMsg as {
            table: string;
            data: Array<{
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
              last_price: parseFloat(x.last),
              last_quantity: parseFloat(x.last_qty),
              best_bid_price: parseFloat(x.best_bid),
              best_bid_quantity: parseFloat(x.best_bid_size),
              best_ask_price: parseFloat(x.best_ask),
              best_ask_quantity: parseFloat(x.best_ask_size),
              open_price_24h: parseFloat(x.open_24h),
              high_price_24h: parseFloat(x.high_24h),
              low_price_24h: parseFloat(x.low_24h),
              base_volume_24h: parseFloat(x.base_volume_24h),
              quote_volume_24h: parseFloat(x.quote_volume_24h),
            };
          });

          tickerMsges.forEach(async (tickerMsg) => msgCallback(tickerMsg));
          break;
        }
        case 'Trade': {
          const rawTradeMsg = rawMsg as {
            table: string;
            data: Array<{
              instrument_id: string;
              price: string;
              side: 'buy' | 'sell';
              size: string;
              timestamp: string;
              trade_id: string;
            }>;
          };
          const tradeMsges: TradeMsg[] = rawTradeMsg.data.map((x) => ({
            exchange: EXCHANGE_NAME,
            marketType,
            pair: marketMap.get(x.instrument_id)!.pair,
            rawPair: x.instrument_id,
            channel: rawMsg.table,
            channelType,
            timestamp: new Date(x.timestamp).getTime(),
            raw: x,
            price: parseFloat(x.price),
            quantity: parseFloat(x.size),
            side: x.side === 'sell',
            trade_id: x.trade_id,
          }));

          tradeMsges.forEach(async (tradeMsg) => msgCallback(tradeMsg));
          break;
        }
        default:
          logger.error(`Unknown channel: ${obj.table}`);
      }
    },
    [{ op: 'subscribe', args: channels }],
    logger,
  );
}
