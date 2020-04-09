import { Client, IFrame, Message } from '@stomp/stompjs';
import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'WhaleEx';
const WEBSOCKET_ENDPOINT = 'wss://www.whaleex.com/ws/websocket';

// see https://github.com/stomp-js/stompjs/issues/28#issuecomment-554984094
Object.assign(global, { WebSocket: require('ws') }); // eslint-disable-line global-require

function getChannel(channeltype: ChannelType, pair: string, markets: readonly Market[]): string {
  const market = markets.filter((m) => m.type === 'Spot' && m.pair === pair)[0];
  assert.ok(market);
  assert.equal(market.exchange, EXCHANGE_NAME);
  switch (channeltype) {
    case 'OrderBook':
      return `/${market.id}@depth5`;
    case 'Trade':
      return `/${market.id}@trade`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.equal('Spot', marketType, 'WhaleEx has only Spot market');
  const [logger, exchangeInfo] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const client = new Client({
    brokerURL: WEBSOCKET_ENDPOINT,
    connectHeaders: {
      login: 'guest',
      passcode: 'guest',
    },
    heartbeatIncoming: 3000,
    heartbeatOutgoing: 3000,
  });
  client.onConnect = (frame: IFrame): void => {
    if (frame.command === 'CONNECTED') {
      logger.info('Connected to Stomp successfully!');
    } else {
      throw Error('Error connecting to server!');
    }

    channelTypes.forEach((channelType) => {
      pairs.forEach((pair) => {
        const channel = getChannel(channelType, pair, exchangeInfo);
        client.subscribe(channel, async (message: Message) => {
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
                [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
              };
              assert.equal(rawMsg.type, 'B');

              const msg: OrderBookMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair,
                rawPair: rawMsg.symbol,
                channel,
                channelType,
                timestamp: parseInt(rawMsg.timestamp, 10),
                raw: JSON.parse(message.body),
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
              msg.asks = rawMsg.asks.map((text) => parseOrder(text));
              msg.bids = rawMsg.bids.map((text) => parseOrder(text));

              await msgCallback(msg);
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
                exchange: EXCHANGE_NAME,
                marketType,
                pair,
                rawPair: rawMsg.symbol,
                channel,
                channelType,
                timestamp: parseInt(rawMsg.timestamp, 10),
                raw: JSON.parse(message.body),
                price: parseFloat(rawMsg.price),
                quantity: parseFloat(rawMsg.quantity),
                side: rawMsg.bidAsk === 'A',
                trade_id: rawMsg.tradeId,
              };
              await msgCallback(msg);
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

  client.onStompError = (frame: IFrame): void => {
    logger.error(frame);
  };

  client.activate();
}
