import { strict as assert } from 'assert';
import WebSocket from 'ws';
import { ExchangeInfo } from 'exchange-info';
import { getChannels, initBeforeCrawl } from './util';
import { TradeMsg, BboMsg, OrderItem, OrderBookMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

const EXCHANGE_NAME = 'Kraken';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  assert.equal(exchangeInfo.name, EXCHANGE_NAME);
  assert.ok(pair);
  switch (channeltype) {
    case 'BBO':
      return 'spread';
    case 'OrderBook':
      return 'book';
    case 'Trade':
      return 'trade';
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  if (channel.startsWith('book')) return 'OrderBook';
  let result: ChannelType;

  switch (channel) {
    case 'spread':
      result = 'BBO';
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
  const [logger, exchangeInfo, pairMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);

  const websocket = new WebSocket(exchangeInfo.websocket_endpoint);
  websocket.on('open', () => {
    logger.info(`${websocket.url} connected`);
    channels.forEach(channel => {
      const command = {
        event: 'subscribe',
        pair: pairs.map(p => exchangeInfo.pairs[p].raw_pair),
        subscription: {
          name: channel,
        },
      };
      websocket.send(JSON.stringify(command));
    });
  });
  websocket.on('message', data => {
    const raw = data as string;
    const rawMsg = JSON.parse(raw);

    if (rawMsg.event === 'heartbeat') {
      websocket.send(
        JSON.stringify({
          event: 'ping',
          reqid: 42,
        }),
      );
      return;
    }
    if (
      rawMsg.event === 'pong' ||
      rawMsg.event === 'systemStatus' ||
      rawMsg.event === 'subscriptionStatus'
    ) {
      logger.info(rawMsg);
      return;
    }

    if (rawMsg instanceof Array) {
      const arr = rawMsg as any[];
      const channel = arr[2] as string;
      const rawPair = arr[3] as string;
      const normalizedPair = pairMap.get(rawPair)!.normalized_pair;
      const channelType = getChannelType(channel);
      switch (channelType) {
        case 'BBO': {
          const rawBboMsg = arr[1] as string[];
          assert.equal(rawBboMsg.length, 5);
          const bboMsg: BboMsg = {
            exchange: exchangeInfo.name,
            channel,
            pair: normalizedPair,
            timestamp: Math.floor(parseFloat(rawBboMsg[2]) * 1000),
            raw,
            bidPrice: parseFloat(rawBboMsg[0]),
            bidQuantity: parseFloat(rawBboMsg[3]),
            askPrice: parseFloat(rawBboMsg[1]),
            askQuantity: parseFloat(rawBboMsg[4]),
          };

          msgCallback(bboMsg);
          break;
        }
        case 'OrderBook': {
          const parseOrderItem = (orderText: string[]): OrderItem => {
            assert.ok(orderText.length === 3 || orderText.length === 4);
            const orderItem: OrderItem = {
              price: parseFloat(orderText[0]),
              quantity: parseFloat(orderText[1]),
              timestamp: Math.floor(parseFloat(orderText[2]) * 1000),
              cost: 0,
            };
            orderItem.cost = orderItem.price * orderItem.quantity;
            return orderItem;
          };

          if (arr[1].as) {
            const rawFullOrderBookMsg = arr[1] as { as: string[][]; bs: string[][] };
            const orderbook: OrderBookMsg = {
              exchange: exchangeInfo.name,
              channel,
              pair: normalizedPair,
              timestamp: Date.now(),
              raw,
              asks: [],
              bids: [],
              full: true,
            };
            orderbook.asks = rawFullOrderBookMsg.as.map(x => parseOrderItem(x));
            orderbook.bids = rawFullOrderBookMsg.bs.map(x => parseOrderItem(x));
            msgCallback(orderbook);
          } else {
            const rawOrderBookUpdateMsg = arr[1] as { a: string[][]; b: string[][] };
            const orderbook: OrderBookMsg = {
              exchange: exchangeInfo.name,
              channel,
              pair: normalizedPair,
              timestamp: Date.now(),
              raw,
              asks: [],
              bids: [],
              full: false,
            };
            if (rawOrderBookUpdateMsg.a) {
              orderbook.asks = rawOrderBookUpdateMsg.a.map(x => parseOrderItem(x));
            }
            if (rawOrderBookUpdateMsg.b) {
              orderbook.bids = rawOrderBookUpdateMsg.b.map(x => parseOrderItem(x));
            }
            msgCallback(orderbook);
          }
          break;
        }
        case 'Trade': {
          const rawTradeMsgArray = arr[1] as string[][];
          assert.equal(rawTradeMsgArray[0].length, 6);
          rawTradeMsgArray.forEach(async rawTradeMsg => {
            assert.equal(rawTradeMsg.length, 6);
            const msg: TradeMsg = {
              exchange: exchangeInfo.name,
              channel,
              pair: normalizedPair,
              timestamp: Math.floor(parseFloat(rawTradeMsg[2]) * 1000),
              raw: JSON.stringify(rawTradeMsg),
              price: parseFloat(rawTradeMsg[0]),
              quantity: parseFloat(rawTradeMsg[1]),
              side: rawTradeMsg[2] === 's', // s, b
              trade_id: '',
            };
            await msgCallback(msg);
          });
          break;
        }
        default:
          logger.warn(`Unrecognized channel type: ${channelType}`);
      }
    }
  });
  websocket.on('error', error => {
    logger.error(JSON.stringify(error));
    process.exit(1); // fail fast, pm2 will restart it
  });
  websocket.on('close', () => {
    logger.info(`${websocket.url} disconnected`);
    process.exit(); // pm2 will restart it
  });
}
