import { strict as assert } from 'assert';
import { ExchangeInfo } from 'exchange-info';
import { connect, getChannels, initBeforeCrawl } from './util';
import { OrderItem, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

const EXCHANGE_NAME = 'Bitstamp';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  const pairInfo = exchangeInfo.pairs[pair];
  const rawPair = pairInfo.raw_pair;
  switch (channeltype) {
    case 'FullOrderBook':
      return `order_book_${rawPair}`;
    case 'OrderBookUpdate':
      return `diff_order_book_${rawPair}`;
    case 'Trade':
      return `live_trades_${rawPair}`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  let result: ChannelType | undefined;
  if (channel.startsWith('order_book_')) {
    result = 'FullOrderBook';
  } else if (channel.startsWith('diff_order_book_')) {
    result = 'OrderBookUpdate';
  } else if (channel.startsWith('live_trades_')) {
    result = 'Trade';
  } else {
    throw Error(`Unknown channel: ${channel}`);
  }
  return result;
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo, pairMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);

  connect(
    exchangeInfo.websocket_endpoint,
    async text => {
      const raw = text as string;
      const data = JSON.parse(raw) as {
        event: string;
        channel: string;
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
      const pair = pairMap.get(rawPair)!.normalized_pair;
      switch (channelType) {
        case 'FullOrderBook':
        case 'OrderBookUpdate': {
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
            exchange: exchangeInfo.name,
            channel: rawOrderBookMsg.channel,
            pair,
            timestamp: Math.floor(parseInt(rawOrderBookMsg.data.microtimestamp, 10) / 1000),
            raw,
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
          orderBookMsg.asks = rawOrderBookMsg.data.asks.map(x => parseOrder(x));
          orderBookMsg.bids = rawOrderBookMsg.data.bids.map(x => parseOrder(x));

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
            exchange: exchangeInfo.name,
            channel: rawTradeMsg.channel,
            pair,
            timestamp: Math.floor(parseInt(rawTradeMsg.data.microtimestamp, 10) / 1000),
            raw,
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
    channels.map(channel => ({
      event: 'bts:subscribe',
      data: {
        channel,
      },
    })),
    logger,
  );
}
