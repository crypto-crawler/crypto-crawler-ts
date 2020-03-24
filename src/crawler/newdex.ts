import { strict as assert } from 'assert';
import { ExchangeInfo, NewdexPairInfo } from 'exchange-info';
import WebSocket from 'ws';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Newdex';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  const pairInfo = exchangeInfo.pairs[pair] as NewdexPairInfo;
  switch (channeltype) {
    case 'OrderBook':
      return `depth.${pairInfo.pair_symbol}:${pairInfo.price_precision}`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo, pairMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const connect = (url: string): void => {
    const websocket = new WebSocket(url);

    websocket.on('open', () => {
      logger!.info(`${websocket.url} connected`);
      websocket.send(JSON.stringify({ type: 'handshake', version: '1.4' }));
    });

    websocket.on('message', async (data) => {
      const raw = data as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMsg = JSON.parse(raw) as { type: string; [key: string]: any };
      switch (rawMsg.type) {
        case 'handshake': {
          logger.info('Handshake succeeded!');

          getChannels(channelTypes, pairs, exchangeInfo, getChannel).forEach((channel) => {
            websocket.send(
              JSON.stringify({
                channel,
                type: 'subscribe',
              }),
            );
          });

          const handshakeData = rawMsg as {
            type: string;
            data: { version: number; heartbeat: { interval: number } };
          };
          setInterval(() => {
            websocket.send(JSON.stringify({ type: 'heartbeat' }));
          }, handshakeData.data.heartbeat.interval * 1000);
          break;
        }
        case 'push': {
          if (rawMsg.channel.startsWith('depth.')) {
            const rawOrderBookMsg = rawMsg as {
              type: string;
              channel: string;
              data: { asks: string[]; bids: string[]; full: number };
            };
            const rawPair = rawOrderBookMsg.channel.substring(
              'depth.'.length,
              rawOrderBookMsg.channel.length - 2,
            );

            const msg: OrderBookMsg = {
              exchange: exchangeInfo.name,
              marketType: 'Spot',
              pair: pairMap.get(rawPair)!.normalized_pair,
              rawPair,
              channel: rawOrderBookMsg.channel,
              channelType: 'OrderBook',
              timestamp: new Date().getTime(),
              raw,
              asks: [],
              bids: [],
              full: rawOrderBookMsg.data.full === 1,
            };
            const parseOrder = (text: string): OrderItem => {
              const arr = text.split(':');
              assert.equal(arr.length, 3);
              const orderItem: OrderItem = {
                price: parseFloat(arr[0]),
                quantity: parseFloat(arr[1]),
                cost: parseFloat(arr[2]),
              };
              return orderItem;
            };
            rawOrderBookMsg.data.asks.reverse().forEach((text) => {
              msg.asks.push(parseOrder(text));
            });
            rawOrderBookMsg.data.bids.forEach((text) => {
              msg.bids.push(parseOrder(text));
            });
            await msgCallback(msg);
          } else {
            logger.warn(rawMsg);
          }
          break;
        }
        default: {
          throw Error('Unrecognized type');
        }
      }
    });

    websocket.on('error', (error) => {
      logger!.error(JSON.stringify(error));
      process.exit(1); // fail fast, pm2 will restart it
    });
    websocket.on('close', () => {
      logger!.info(`${websocket.url} disconnected, now re-connecting`);
      setTimeout(() => {
        connect(url);
      }, 1000);
    });
  };

  connect(exchangeInfo.websocket_endpoint);
}
