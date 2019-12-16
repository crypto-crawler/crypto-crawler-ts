import WebSocket from 'ws';
import { Logger } from 'winston';
import { ExchangeInfo, PairInfo } from 'exchange-info';
import { ChannelType } from './index';

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

export async function listenWebSocket(
  websocket: WebSocket,
  handleData: (data: WebSocket.Data) => Promise<void>,
  logger: Logger,
): Promise<void> {
  websocket.on('message', handleData);
  websocket.on('open', () => {
    logger.info(`${websocket.url} connected`);
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

export function buildPairMap(pairs: { [key: string]: PairInfo }): Map<string, PairInfo> {
  const result = new Map<string, PairInfo>();
  Object.keys(pairs).forEach(p => {
    const pairInfo = pairs[p];
    result.set(pairInfo.raw_pair, pairInfo);
  });
  return result;
}
