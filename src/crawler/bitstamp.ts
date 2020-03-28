import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Bitstamp';
const WEBSOCKET_ENDPOINT = 'wss://ws.bitstamp.net';

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  assert.equal('Spot', marketType);
  const market = markets.filter((m) => m.type === 'Spot' && m.pair === pair)[0];

  const rawPair = market.id;
  switch (channeltype) {
    case 'OrderBook':
      return [`diff_order_book_${rawPair}`];
    case 'Trade':
      return [`live_trades_${rawPair}`];
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  let result: ChannelType | undefined;
  if (channel.startsWith('diff_order_book_')) {
    result = 'OrderBook';
  } else if (channel.startsWith('live_trades_')) {
    result = 'Trade';
  } else {
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
  assert.equal('Spot', marketType, 'Bitstamp has only Spot market');

  const [logger, markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.equal(channels.length, channelTypes.length * pairs.length);

  connect(
    WEBSOCKET_ENDPOINT,
    async (text) => {
      const raw = text as string;
      const data = JSON.parse(raw) as {
        event: string;
        channel: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { microtimestamp: string; [key: string]: any };
      };
      if (
        data.event === 'bts:subscription_succeeded' ||
        data.event === 'bts:unsubscription_succeeded'
      ) {
        logger.info(data);
        return;
      }
      if (data.event === 'bts:request_reconnect') {
        logger.warn(data);
        logger.warn('Need to reconnect now');
        return;
      }
      const channelType = getChannelType(data.channel);
      const rawPair = data.channel.split('_').slice(-1)[0];
      const { pair } = marketMap.get(rawPair)!;
      switch (channelType) {
        case 'OrderBook': {
          assert.equal(data.event, 'data');
          const rawOrderBookMsg = data as {
            event: string;
            channel: string;
            data: {
              microtimestamp: string;
              asks: string[][];
              bids: string[][];
            };
          };
          const orderBookMsg: OrderBookMsg = {
            exchange: EXCHANGE_NAME,
            marketType: 'Spot',
            pair,
            rawPair,
            channel: rawOrderBookMsg.channel,
            channelType,
            timestamp: Math.floor(parseInt(rawOrderBookMsg.data.microtimestamp, 10) / 1000),
            raw: rawOrderBookMsg,
            asks: [],
            bids: [],
            full: rawOrderBookMsg.channel.startsWith('order_book_'),
          };
          const parseOrder = (arr: string[]): OrderItem => {
            assert.equal(arr.length, 2);
            const orderItem: OrderItem = {
              price: parseFloat(arr[0]),
              quantity: parseFloat(arr[1]),
              cost: 0,
            };
            orderItem.cost = orderItem.price * orderItem.quantity;
            return orderItem;
          };
          orderBookMsg.asks = rawOrderBookMsg.data.asks.map((x) => parseOrder(x));
          orderBookMsg.bids = rawOrderBookMsg.data.bids.map((x) => parseOrder(x));

          msgCallback(orderBookMsg);
          break;
        }
        case 'Trade': {
          assert.equal(data.event, 'trade');
          const rawTradeMsg = data as {
            data: {
              microtimestamp: string;
              amount: number;
              buy_order_id: number;
              sell_order_id: number;
              amount_str: string;
              price_str: string;
              timestamp: string;
              price: number;
              type: number;
              id: number;
            };
            event: string;
            channel: string;
          };
          const tradeMsg: TradeMsg = {
            exchange: EXCHANGE_NAME,
            marketType: 'Spot',
            pair,
            rawPair,
            channel: rawTradeMsg.channel,
            channelType,
            timestamp: Math.floor(parseInt(rawTradeMsg.data.microtimestamp, 10) / 1000),
            raw: rawTradeMsg,
            price: rawTradeMsg.data.price,
            quantity: rawTradeMsg.data.amount,
            side: rawTradeMsg.data.type === 1,
            trade_id: rawTradeMsg.data.id.toString(),
          };
          await msgCallback(tradeMsg);
          break;
        }
        default:
          logger.warn(`Unrecognized CrawlType: ${channelType}`);
          logger.warn(data);
      }
    },
    channels.map((channel) => ({
      event: 'bts:subscribe',
      data: {
        channel,
      },
    })),
    logger,
  );
}
