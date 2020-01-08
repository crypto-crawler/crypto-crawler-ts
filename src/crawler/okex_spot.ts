import { strict as assert } from 'assert';
import { ExchangeInfo } from 'exchange-info';
import Pako from 'pako';
import { BboMsg, OrderBookMsg, OrderItem, TickerMsg, TradeMsg } from '../pojo/msg';
import { ChannelType, defaultMsgCallback, MsgCallback } from './index';
import { connect, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'OKEx_Spot';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  assert.equal(exchangeInfo.name, EXCHANGE_NAME);
  const rawPair = pair.replace('_', '-');
  switch (channeltype) {
    case 'BBO':
      return `spot/depth5:${rawPair}`;
    case 'OrderBook':
      return `spot/optimized_depth:${rawPair}`;
    case 'Ticker':
      return `spot/ticker:${rawPair}`;
    case 'Trade':
      return `spot/trade:${rawPair}`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes('/'));
  const channelName = channel.split('/')[1];
  let result: ChannelType;
  switch (channelName) {
    case 'depth5':
      return 'BBO';
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
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);

  connect(
    exchangeInfo.websocket_endpoint,
    data => {
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
        data: Array<any>;
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
            channel: rawOrderBookMsg.table,
            pair: rawOrderBookMsg.data[0].instrument_id.replace('-', '_'),
            timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
            raw,
            asks: [],
            bids: [],
            full: true,
          };
          const parse = (item: [string, string, number]): OrderItem => ({
            price: parseFloat(item[0]),
            quantity: parseFloat(item[1]),
            cost: parseFloat(item[0]) * parseFloat(item[1]),
          });
          orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map(x => parse(x));
          orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map(x => parse(x));

          const bboMsg: BboMsg = {
            exchange: EXCHANGE_NAME,
            channel: orderBookMsg.channel,
            pair: orderBookMsg.pair,
            timestamp: orderBookMsg.timestamp,
            raw,
            bidPrice: orderBookMsg.bids[0].price,
            bidQuantity: orderBookMsg.bids[0].quantity,
            askPrice: orderBookMsg.asks[0].price,
            askQuantity: orderBookMsg.asks[0].quantity,
          };
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
            channel: rawOrderBookMsg.table,
            pair: rawOrderBookMsg.data[0].instrument_id.replace('-', '_'),
            timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
            raw,
            asks: [],
            bids: [],
            full: rawOrderBookMsg.action === 'partial',
          };
          const parse = (item: [string, string, number]): OrderItem => ({
            price: parseFloat(item[0]),
            quantity: parseFloat(item[1]),
            cost: parseFloat(item[0]) * parseFloat(item[1]),
          });
          orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map(x => parse(x));
          orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map(x => parse(x));

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

          const tickerMsges: TickerMsg[] = rawTickerMsg.data.map(x => {
            return {
              exchange: EXCHANGE_NAME,
              channel: rawTickerMsg.table,
              pair: x.instrument_id.replace('-', '_'),
              timestamp: new Date(x.timestamp).getTime(),
              raw,
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

          tickerMsges.forEach(async tickerMsg => msgCallback(tickerMsg));
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
          const tradeMsges: TradeMsg[] = rawTradeMsg.data.map(x => ({
            exchange: EXCHANGE_NAME,
            channel: rawMsg.table,
            pair: x.instrument_id.replace('-', '_'),
            timestamp: new Date(x.timestamp).getTime(),
            raw,
            price: parseFloat(x.price),
            quantity: parseFloat(x.size),
            side: x.side === 'sell',
            trade_id: x.trade_id,
          }));

          tradeMsges.forEach(async tradeMsg => msgCallback(tradeMsg));
          break;
        }
        default:
          logger.error(`Unknown channel: ${obj.ch}`);
      }
    },
    [{ op: 'subscribe', args: channels }],
    logger,
  );
}
