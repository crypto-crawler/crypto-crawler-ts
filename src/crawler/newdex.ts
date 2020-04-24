import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import WebSocket from 'ws';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { debug, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Newdex';
const WEBSOCKET_ENDPOINT = 'wss://ws.newdex.io';

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  assert.equal('Spot', marketType, 'Newdex has only Spot market');
  const market = markets.filter((m) => m.type === marketType && m.pair === pair)[0];
  assert.ok(market);
  switch (channeltype) {
    case 'OrderBook':
      return [`depth.${market.id}:${market.precision.price}`];
    case 'Trade':
      return [`latest.${market.id}`];
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
  assert.equal('Spot', marketType, 'Newdex has only Spot market');
  const [markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const connect = (url: string): void => {
    const websocket = new WebSocket(url);

    websocket.on('open', () => {
      debug(`${websocket.url} connected`);
      websocket.send(JSON.stringify({ type: 'handshake', version: '1.4' }));
    });

    websocket.on('message', async (data) => {
      const raw = data as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMsg = JSON.parse(raw) as { type: string; [key: string]: any };
      switch (rawMsg.type) {
        case 'handshake': {
          debug('Handshake succeeded!');

          getChannels(marketType, channelTypes, pairs, markets, getChannel).forEach((channel) => {
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
          const [channel, rawPair] = rawMsg.channel.split(':')[0].split('.');
          const market = marketMap.get(rawPair)!;
          assert.equal(market.exchange, EXCHANGE_NAME);

          switch (channel) {
            case 'depth': {
              const rawOrderBookMsg = rawMsg as {
                type: string;
                channel: string;
                data: { asks: string[]; bids: string[]; full: number };
              };

              const msg: OrderBookMsg = {
                exchange: EXCHANGE_NAME,
                marketType: 'Spot',
                pair: market.pair,
                rawPair,
                channel: rawOrderBookMsg.channel,
                channelType: 'OrderBook',
                timestamp: new Date().getTime(),
                raw: rawMsg,
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

              msgCallback(msg);
              break;
            }
            case 'latest': {
              const rawTradeMsges = rawMsg as {
                type: string;
                channel: string;
                data: readonly {
                  id: number;
                  price: number;
                  amount: number;
                  volume: number;
                  time: number;
                  active_direction: number;
                }[];
              };
              const tradeMsges: TradeMsg[] = rawTradeMsges.data.map((x) => {
                return {
                  exchange: EXCHANGE_NAME,
                  marketType,
                  pair: market.pair,
                  rawPair,
                  channel: rawMsg.channel,
                  channelType: 'Trade',
                  timestamp: x.time * 1000,
                  raw: x,
                  price: x.price,
                  quantity: x.amount,
                  side: x.active_direction === 2,
                  trade_id: x.id.toString(),
                };
              });

              tradeMsges.forEach((x) => msgCallback(x));
              break;
            }
            default: {
              debug(rawMsg);
              throw new Error(`Unknown channel ${channel}`);
            }
          }
          break;
        }
        default: {
          throw Error('Unrecognized type');
        }
      }
    });

    websocket.on('error', (error) => {
      debug(JSON.stringify(error));
      process.exit(1); // fail fast, pm2 will restart it
    });
    websocket.on('close', () => {
      debug(`${websocket.url} disconnected, now re-connecting`);
      setTimeout(() => {
        connect(url);
      }, 1000);
    });
  };

  connect(WEBSOCKET_ENDPOINT);
}
