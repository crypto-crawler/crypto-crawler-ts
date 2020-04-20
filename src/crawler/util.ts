import { strict as assert } from 'assert';
import fetchMarkets, { Market, MarketType } from 'crypto-markets';
import Debug from 'debug';
import Pako from 'pako';
import WebSocket from 'ws';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg } from '../pojo/msg';

export const debug = Debug.debug('crypto-crawler');

export function getChannels(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  markets: readonly Market[],
  getChannel: (
    marketType: MarketType,
    channeltype: ChannelType,
    pair: string,
    markets: readonly Market[],
  ) => readonly string[],
): readonly string[] {
  const channels: string[] = [];
  channelTypes.forEach((channelType) => {
    pairs.forEach((pair) => {
      const channel = getChannel(marketType, channelType, pair, markets);
      channels.push(...channel);
    });
  });
  return channels;
}

// This function re-connects on close.
export function connect(
  url: string,
  onMessage: (data: WebSocket.Data) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscriptions?: readonly { [key: string]: any }[],
): void {
  const websocket = new WebSocket(url);

  websocket.on('open', () => {
    debug(`${websocket.url} connected`);

    if (subscriptions !== undefined) {
      subscriptions.forEach((x) => {
        websocket.send(JSON.stringify(x));
      });
    }
  });

  websocket.on('message', (data) => {
    // Huobi
    if (url.includes('huobi.pro') || url.includes('hbdm.com')) {
      const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (obj.ping) {
        websocket.send(JSON.stringify({ pong: obj.ping }));
        return;
      }
    }

    if (typeof data === 'string') {
      const obj = JSON.parse(data);

      // Kraken
      if (url.includes('kraken.com')) {
        if (obj.event === 'heartbeat') {
          websocket.send(
            JSON.stringify({
              event: 'ping',
              reqid: 42,
            }),
          );
          return;
        }
      }
    }

    onMessage(data);
  });

  websocket.on('error', (error) => {
    debug(JSON.stringify(error));
    websocket.close();
    // process.exit(1); // fail fast, pm2 will restart it
  });
  websocket.on('close', () => {
    debug(`${websocket.url} disconnected, now re-connecting`);
    setTimeout(() => {
      connect(url, onMessage, subscriptions);
    }, 1000);
  });
}

export function buildMarketMap(markets: readonly Market[]): Map<string, Market> {
  const result = new Map<string, Market>();
  markets.forEach((market) => {
    result.set(market.id, market);
  });
  return result;
}

export async function initBeforeCrawl(
  exchange: string,
  pairs: readonly string[],
  marketType: MarketType = 'Spot',
): Promise<[readonly Market[], Map<string, Market>]> {
  let error: Error | undefined;
  let markets: readonly Market[] = [];
  // retry 3 times
  for (let i = 0; i < 3; i += 1) {
    try {
      markets = await fetchMarkets(exchange, marketType); // eslint-disable-line no-await-in-loop
      break;
    } catch (e) {
      error = e;
    }
  }
  if (error) {
    throw error;
  }

  // id -> Market
  const marketMap = buildMarketMap(markets);
  // empty means all pairs
  // if (pairs.length === 0) {
  //   // clear pairs and copy all pairs into it
  //   pairs.splice(0, pairs.length, ...markets.map((x) => x.pair));
  // }
  debug(pairs);

  return [markets, marketMap];
}

export function convertFullOrderBookMsgToBboMsg(orderBookMsg: OrderBookMsg): BboMsg {
  assert.equal(orderBookMsg.channelType, 'OrderBook');
  assert.ok(orderBookMsg.full);

  const bboMsg: BboMsg = {
    exchange: orderBookMsg.exchange,
    marketType: orderBookMsg.marketType,
    pair: orderBookMsg.pair,
    rawPair: orderBookMsg.rawPair,
    channel: orderBookMsg.channel,
    channelType: 'BBO',
    timestamp: orderBookMsg.timestamp,
    raw: orderBookMsg.raw,
    bidPrice: orderBookMsg.bids[0].price,
    bidQuantity: orderBookMsg.bids[0].quantity,
    askPrice: orderBookMsg.asks[0].price,
    askQuantity: orderBookMsg.asks[0].quantity,
  };
  return bboMsg;
}
