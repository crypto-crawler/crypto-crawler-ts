import { strict as assert } from 'assert';
import getExchangeInfo, { ExchangeInfo } from 'exchange-info';
import { Client, IFrame, Message } from '@stomp/stompjs';
import { OrderItem, OrderBookMsg, TradeMsg } from '../pojo/msg';
import createLogger from '../util/logger';
import { ChannelType, ProcessMessageCallback, defaultProcessMessageCallback } from './index';

// see https://github.com/stomp-js/stompjs/issues/28#issuecomment-554984094
Object.assign(global, { WebSocket: require('ws') }); // eslint-disable-line global-require

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  const pairInfo = exchangeInfo.pairs[pair];
  switch (channeltype) {
    case 'OrderBook':
      return `/${pairInfo.raw_pair}@depth5`;
    case 'Trade':
      return `/${pairInfo.raw_pair}@trade`;
    default:
      throw Error(`CrawlType ${channeltype} is not supported for WhaleEx yet`);
  }
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  processMsgCallback: ProcessMessageCallback = defaultProcessMessageCallback,
): Promise<void> {
  const logger = createLogger('WhaleEx');
  const exchangeInfo = await getExchangeInfo('WhaleEx');
  // empty means all pairs
  if (pairs.length === 0) {
    pairs = Object.keys(exchangeInfo.pairs); // eslint-disable-line no-param-reassign
  }
  logger.info(pairs);

  const client = new Client({
    brokerURL: exchangeInfo.websocket_endpoint,
    connectHeaders: {
      login: 'guest',
      passcode: 'guest',
    },
    heartbeatIncoming: 3000,
    heartbeatOutgoing: 3000,
  });
  client.onConnect = (frame: IFrame) => {
    if (frame.command === 'CONNECTED') {
      logger.info('Connected to Stomp successfully!');
    } else {
      throw Error('Error connecting to server!');
    }

    channelTypes.forEach(channelType => {
      pairs.forEach(pair => {
        const channel = getChannel(channelType, pair, exchangeInfo);
        client.subscribe(channel, (message: Message) => {
          assert.equal(message.command, 'MESSAGE');
          assert.equal(channel, message.headers.destination);
          switch (channelType) {
            case 'OrderBook': {
              const rawMsg = JSON.parse(message.body) as {
                type: string;
                timestamp: string;
                symbol: string;
                asks: string[];
                bids: string[];
                [key: string]: any;
              };
              assert.equal(rawMsg.type, 'B');

              const msg: OrderBookMsg = {
                exchange: exchangeInfo.name,
                channel,
                pair,
                timestamp: parseInt(rawMsg.timestamp, 10),
                raw: message.body,
                asks: [],
                bids: [],
                full: true,
              };
              const parseOrder = (text: string): OrderItem => {
                const arr = text.split(':');
                assert.equal(arr.length, 2);
                const orderItem: OrderItem = {
                  price: parseFloat(arr[0]),
                  quantity: parseFloat(arr[1]),
                  cost: 0,
                };
                orderItem.cost = orderItem.price * orderItem.quantity;
                return orderItem;
              };
              rawMsg.asks.forEach((text: string) => {
                msg.asks.push(parseOrder(text));
              });
              rawMsg.bids.forEach((text: string) => {
                msg.bids.push(parseOrder(text));
              });
              processMsgCallback(msg);
              break;
            }
            case 'Trade': {
              const rawMsg = JSON.parse(message.body) as {
                type: string;
                timestamp: string;
                tradeId: string;
                symbol: string;
                price: string;
                quantity: string;
                bidAsk: string;
              };
              assert.equal(rawMsg.type, 'T');

              const msg: TradeMsg = {
                exchange: exchangeInfo.name,
                channel,
                pair,
                timestamp: parseInt(rawMsg.timestamp, 10),
                raw: message.body,
                price: parseFloat(rawMsg.price),
                quantity: parseFloat(rawMsg.quantity),
                side: rawMsg.bidAsk === 'A',
                trade_id: parseInt(rawMsg.tradeId, 10),
              };
              processMsgCallback(msg);
              break;
            }
            default:
              logger.warn(`Unrecognized ChannelType: ${channelType}`);
              logger.warn(message);
              break;
          }
        });
      });
    });
  };

  client.onStompError = (frame: IFrame) => {
    logger.error(frame);
  };

  client.activate();
}
