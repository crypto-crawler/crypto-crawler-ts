import WebSocket from 'ws';
import Pako from 'pako';
import { Logger } from 'winston';
import getExchangeInfo, { ExchangeInfo, PairInfo, SupportedExchange } from 'exchange-info';

import { ChannelType } from './index';
import createLogger from '../util/logger';

export function getChannels(
  channelTypes: ChannelType[],
  pairs: string[],
  exchangeInfo: ExchangeInfo,
  getChannel: (channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo) => string,
): string[] {
  const channels: string[] = [];
  channelTypes.forEach(channelType => {
    pairs.forEach(pair => {
      const channel = getChannel(channelType, pair, exchangeInfo);
      channels.push(channel);
    });
  });
  return channels;
}

// This function re-connects on close.
export function connect(
  url: string,
  onMessage: (data: WebSocket.Data) => void,
  subscriptions?: Array<{ [key: string]: any }>,
  logger?: Logger,
): void {
  const websocket = new WebSocket(url);

  if (logger === undefined) {
    logger = (console as unknown) as Logger; // eslint-disable-line no-param-reassign
  }

  websocket.on('open', () => {
    logger!.info(`${websocket.url} connected`);

    if (subscriptions !== undefined) {
      subscriptions.forEach(x => {
        websocket.send(JSON.stringify(x));
      });
    }
  });

  websocket.on('message', data => {
    // Huobi
    if (url.includes('huobi.pro')) {
      const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (obj.ping) {
        websocket.pong();
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

  websocket.on('error', error => {
    logger!.error(JSON.stringify(error));
    process.exit(1); // fail fast, pm2 will restart it
  });
  websocket.on('close', () => {
    logger!.info(`${websocket.url} disconnected, now re-connecting`);
    setTimeout(() => {
      connect(url, onMessage, subscriptions, logger);
    }, 1000);
  });
}

export function buildPairMap(pairs: { [key: string]: PairInfo }): Map<string, PairInfo> {
  const result = new Map<string, PairInfo>();
  Object.keys(pairs).forEach(p => {
    const pairInfo = pairs[p];
    result.set(pairInfo.raw_pair, pairInfo);
  });
  return result;
}

export async function initBeforeCrawl(
  exchange: SupportedExchange,
  pairs: string[] = [],
): Promise<[Logger, ExchangeInfo, Map<string, PairInfo>]> {
  const logger = createLogger(exchange);
  const exchangeInfo = await getExchangeInfo(exchange);
  // raw_pair -> pairInfo
  const pairMap = buildPairMap(exchangeInfo.pairs);
  // empty means all pairs
  if (pairs.length === 0) {
    // clear pairs and copy all keys of exchangeInfo.pairs into it
    pairs.splice(0, pairs.length, ...Object.keys(exchangeInfo.pairs));
  }
  logger.info(pairs);

  return [logger, exchangeInfo, pairMap];
}
