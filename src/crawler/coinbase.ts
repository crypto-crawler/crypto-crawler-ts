import { strict as assert } from 'assert';
import { WebsocketClient, WebsocketMessage } from 'coinbase-pro';
import { PairInfo } from 'exchange-info';
import { initBeforeCrawl } from './util';
import { OrderItem, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

const EXCHANGE_NAME = 'Coinbase';

function getChannel(channeltype: ChannelType): string {
  switch (channeltype) {
    case 'OrderBook':
      return 'level2';
    case 'Trade':
      return 'matches';
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const idToPairInfoMap: { [key: string]: PairInfo } = {};
  pairs.forEach(p => {
    const pairInfo = exchangeInfo.pairs[p];
    idToPairInfoMap[pairInfo.id as string] = pairInfo;
  });

  const channels = channelTypes.map(x => getChannel(x));
  assert.ok(channels.length > 0);

  const websocket = new WebsocketClient(
    pairs.map(p => exchangeInfo.pairs[p].id as string),
    exchangeInfo.websocket_endpoint,
    undefined,
    { channels },
  );

  websocket.on('open', () => {
    logger.info(`${exchangeInfo.websocket_endpoint} connected`);
  });
  websocket.on('message', (data: { type: string; [key: string]: any }) => {
    if (data.type === 'error') {
      logger.error(data);
      return;
    }
    if (data.type === 'heartbeat') {
      const msg = data as WebsocketMessage.Heartbeat;
      logger.info(msg);
      return;
    }
    if (data.type === 'received') {
      return; // ignore, wait for the exchange to process  this message
    }

    switch (data.type) {
      case 'snapshot': {
        const rawFullOrderBook = data as WebsocketMessage.L2Snapshot;
        const orderBookMsg: OrderBookMsg = {
          exchange: exchangeInfo.name,
          channel: 'level2',
          pair: idToPairInfoMap[rawFullOrderBook.product_id].normalized_pair,
          timestamp: Date.now(),
          raw: JSON.stringify(rawFullOrderBook),
          asks: [],
          bids: [],
          full: true,
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
        orderBookMsg.asks = rawFullOrderBook.asks.map(x => parseOrder(x));
        orderBookMsg.bids = rawFullOrderBook.bids.map(x => parseOrder(x));

        msgCallback(orderBookMsg);
        break;
      }
      case 'l2update': {
        const rawOrderBookUpdate = data as WebsocketMessage.L2Update;
        const orderBookMsg: OrderBookMsg = {
          exchange: exchangeInfo.name,
          channel: 'level2',
          pair: idToPairInfoMap[rawOrderBookUpdate.product_id].normalized_pair,
          timestamp: new Date((rawOrderBookUpdate as any).time as string).getTime(),
          raw: JSON.stringify(rawOrderBookUpdate),
          asks: [],
          bids: [],
          full: false,
        };
        const parse = (arr: [string, string, string]): { side: boolean; order: OrderItem } => {
          assert.equal(arr.length, 3);
          const side = arr[0] === 'sell';
          const price = parseFloat(arr[1]);
          const quantity = parseFloat(arr[2]);
          return {
            side,
            order: {
              price,
              quantity,
              cost: price * quantity,
            },
          };
        };
        const orders = rawOrderBookUpdate.changes.map(x => parse(x));
        orderBookMsg.asks = orders.filter(x => x.side).map(x => x.order);
        orderBookMsg.bids = orders.filter(x => !x.side).map(x => x.order);

        msgCallback(orderBookMsg);
        break;
      }
      case 'match': {
        const rawTradeMsg = data as WebsocketMessage.Match;
        const tradeMsg: TradeMsg = {
          exchange: exchangeInfo.name,
          channel: 'matches',
          pair: idToPairInfoMap[rawTradeMsg.product_id].normalized_pair,
          timestamp: new Date(rawTradeMsg.time).getTime(),
          raw: JSON.stringify(rawTradeMsg),
          price: parseFloat(rawTradeMsg.price),
          quantity: parseFloat(rawTradeMsg.size),
          side: rawTradeMsg.side === 'sell',
          trade_id: rawTradeMsg.trade_id.toString(),
        };
        msgCallback(tradeMsg);
        break;
      }
      default:
        logger.warn(`Unrecognized type: ${data.type}`);
    }
  });
  websocket.on('error', error => {
    logger.error(JSON.stringify(error));
    process.exit(1); // fail fast, pm2 will restart it
  });
  websocket.on('close', () => {
    logger.info(`${exchangeInfo.websocket_endpoint} disconnected`);
    process.exit(); // pm2 will restart it
  });
}
