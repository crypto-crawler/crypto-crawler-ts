import { strict as assert } from 'assert';
import WebSocket from 'ws';
import { ExchangeInfo, NewdexPairInfo } from 'exchange-info';
import { listenWebSocket, getChannels, initBeforeCrawl } from './util';
import { OrderItem, OrderBookMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

const EXCHANGE_NAME = 'Newdex';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  const pairInfo = exchangeInfo.pairs[pair] as NewdexPairInfo;
  switch (channeltype) {
    case 'FullOrderBook':
    case 'OrderBookUpdate':
      return `depth.${pairInfo.pair_symbol}:${pairInfo.price_precision}`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for Newdex yet`);
  }
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo, pairMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const websocket = new WebSocket(exchangeInfo.websocket_endpoint);
  websocket.on('open', () => {
    websocket.send(JSON.stringify({ type: 'handshake', version: '1.4' }));
  });

  listenWebSocket(
    websocket,
    async data => {
      const raw = data as string;
      const rawMsg = JSON.parse(raw) as { type: string; [key: string]: any };
      switch (rawMsg.type) {
        case 'handshake': {
          logger.info('Handshake succeeded!');

          getChannels(channelTypes, pairs, exchangeInfo, getChannel).forEach(channel => {
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
              channel: rawOrderBookMsg.channel,
              pair: pairMap.get(rawPair)!.normalized_pair,
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
            rawOrderBookMsg.data.asks.reverse().forEach(text => {
              msg.asks.push(parseOrder(text));
            });
            rawOrderBookMsg.data.bids.forEach(text => {
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
    },
    logger,
  );
}
