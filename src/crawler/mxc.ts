import { strict as assert } from 'assert';
import { MarketType } from 'crypto-markets';
import WebSocket from 'ws';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { debug } from './util';

const EXCHANGE_NAME = 'MXC';

const WEBSOCKET_ENDPOINT = 'wss://wbs.mxc.com/socket.io/?EIO=3&transport=websocket';
const SOCKETIO_PREFIX = '42';

interface OrderBookAndTrades {
  symbol: string;
  data: {
    asks?: { p: string; q: string; a: string }[];
    bids?: { p: string; q: string; a: string }[];
    deals?: { t: number; p: string; q: string; T: 1 | 2 }[];
  };
}

function getChannel(channeltype: ChannelType): string {
  switch (channeltype) {
    case 'OrderBook':
    case 'Trade':
      return 'sub.symbol';
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

// MXC allows only one pair per connection.
async function crawlOnePair(
  pair: string,
  channelTypes: readonly ChannelType[],
  msgCallback: MsgCallback,
): Promise<void> {
  const websocket = new WebSocket(WEBSOCKET_ENDPOINT);

  let interval: NodeJS.Timeout;
  websocket.on('open', () => {
    debug(`${websocket.url} connected`);
    const channels = new Set(channelTypes.map((type) => getChannel(type)));
    channels.forEach((channel) => {
      websocket.send(`${SOCKETIO_PREFIX}${JSON.stringify([channel, { symbol: pair }])}`);
    });

    interval = setInterval(() => {
      websocket.send('2'); // hearbeat
    }, 5000);
  });

  websocket.on('message', async (data) => {
    const raw = data as string;
    if (!raw.startsWith(SOCKETIO_PREFIX)) return;

    const arr = JSON.parse(raw.slice(2));
    const channel: string = arr[0];

    if (channel === 'push.symbol') {
      const rawMsg: OrderBookAndTrades = arr[1];

      if (rawMsg.data.deals && channelTypes.includes('Trade')) {
        const tradeMsges: TradeMsg[] = rawMsg.data.deals.map((x) => ({
          exchange: EXCHANGE_NAME,
          marketType: 'Spot',
          pair: rawMsg.symbol,
          rawPair: rawMsg.symbol,
          channel: 'sub.symbol',
          channelType: 'Trade',
          timestamp: x.t,
          raw: x,
          price: parseFloat(x.p),
          quantity: parseFloat(x.q),
          side: x.T === 2,
          trade_id: '', // TODO: MXC does NOT have trade ID
        }));

        await Promise.all(tradeMsges.map((tradeMsg) => msgCallback(tradeMsg)));
      }

      if ((rawMsg.data.asks || rawMsg.data.bids) && channelTypes.includes('OrderBook')) {
        const orderBookMsg: OrderBookMsg = {
          exchange: EXCHANGE_NAME,
          marketType: 'Spot',
          pair: rawMsg.symbol,
          rawPair: rawMsg.symbol,
          channel: 'sub.symbol',
          channelType: 'OrderBook',
          timestamp: Date.now(),
          raw: rawMsg,
          asks: [],
          bids: [],
          full: false,
        };
        const parse = (x: { p: string; q: string; a: string }): OrderItem => ({
          price: parseFloat(x.p),
          quantity: parseFloat(x.q),
          cost: parseFloat(x.a),
        });
        if (rawMsg.data.asks) {
          orderBookMsg.asks = rawMsg.data.asks.map(parse);
        }
        if (rawMsg.data.bids) {
          orderBookMsg.bids = rawMsg.data.bids.map(parse);
        }

        await msgCallback(orderBookMsg);
      }
    }
  });

  websocket.on('error', (error) => {
    debug(JSON.stringify(error));
    process.exit(1); // fail fast, pm2 will restart it
  });

  websocket.on('close', () => {
    debug(`${websocket.url} disconnected, now re-connecting`);
    clearInterval(interval);
    setTimeout(() => {
      crawlOnePair(pair, channelTypes, msgCallback);
    }, 1000);
  });
}

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.equal('Spot', marketType, 'MXC has only Spot market');

  await Promise.all(pairs.map((pair) => crawlOnePair(pair, channelTypes, msgCallback)));
}
