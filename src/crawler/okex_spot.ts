import { strict as assert } from 'assert';
import WebSocket from 'ws';
import Pako from 'pako';
import { ExchangeInfo } from 'exchange-info';
import { getChannels, initBeforeCrawl } from './util';
import { OrderItem, OrderBookMsg, TradeMsg, BboMsg } from '../pojo/msg';
import { ChannelType, MsgCallback, defaultMsgCallback } from './index';

const EXCHANGE_NAME = 'OKEx_Spot';

function getChannel(channeltype: ChannelType, pair: string, exchangeInfo: ExchangeInfo): string {
  assert.equal(exchangeInfo.name, EXCHANGE_NAME);
  switch (channeltype) {
    case 'BBO':
      return `spot/depth5:${pair.replace('_', '-')}`;
    case 'OrderBook':
      return `spot/optimized_depth:${pair.replace('_', '-')}`;
    case 'Trade':
      return `spot/trade:${pair.replace('_', '-')}`;
    default:
      throw Error(`ChannelType ${channeltype} is not supported for Newdex yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  assert.ok(channel.includes('/'));
  const channelName = channel.split('/')[1];
  let result: ChannelType;
  switch (channelName) {
    case 'depth5':
      return 'BBO';
    case 'depth':
    case 'optimized_depth':
      result = 'OrderBook';
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
  const [logger, exchangeInfo] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const channels = getChannels(channelTypes, pairs, exchangeInfo, getChannel);
  assert.ok(channels.length > 0);

  const websocketUrl = exchangeInfo.websocket_endpoint;
  const websocket = new WebSocket(websocketUrl);
  websocket.on('open', () => {
    logger.info(`${websocket.url} connected`);
    const events: Array<string> = [];
    pairs.forEach(x => {
      events.push(`{'event':'addChannel','channel':'ok_sub_spot_${x}_deals'}`);
    });
    websocket.send(JSON.stringify({ op: 'subscribe', args: channels }));
  });
  websocket.on('message', data => {
    const raw = Pako.inflateRaw(data as pako.Data, { to: 'string' });
    const obj = JSON.parse(raw);
    if (!(obj.table && obj.data)) {
      logger.warn(obj);
      return;
    }
    const rawMsg = obj as {
      table: string;
      data: Array<any>;
    };

    const channelType = getChannelType(rawMsg.table);
    switch (channelType) {
      case 'BBO': {
        const rawOrderBookMsg = rawMsg as {
          table: string;
          data: [
            {
              instrument_id: string;
              asks: Array<[string, string, number]>;
              bids: Array<[string, string, number]>;
              timestamp: string;
            },
          ];
        };
        assert.equal(rawOrderBookMsg.data.length, 1);
        const orderBookMsg: OrderBookMsg = {
          exchange: EXCHANGE_NAME,
          channel: rawOrderBookMsg.table,
          pair: rawOrderBookMsg.data[0].instrument_id.replace('-', '_'),
          timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
          raw,
          asks: [],
          bids: [],
          full: true,
        };
        const parse = (item: [string, string, number]): OrderItem => ({
          price: parseFloat(item[0]),
          quantity: parseFloat(item[1]),
          cost: parseFloat(item[0]) * parseFloat(item[1]),
        });
        orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map(x => parse(x));
        orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map(x => parse(x));

        const bboMsg: BboMsg = {
          exchange: EXCHANGE_NAME,
          channel: orderBookMsg.channel,
          pair: orderBookMsg.pair,
          timestamp: orderBookMsg.timestamp,
          raw,
          bidPrice: orderBookMsg.bids[0].price,
          bidQuantity: orderBookMsg.bids[0].quantity,
          askPrice: orderBookMsg.asks[0].price,
          askQuantity: orderBookMsg.asks[0].quantity,
        };
        msgCallback(bboMsg);
        break;
      }
      case 'OrderBook': {
        const rawOrderBookMsg = rawMsg as {
          table: string;
          action: 'partial' | 'update';
          data: [
            {
              instrument_id: string;
              asks: Array<[string, string, number]>;
              bids: Array<[string, string, number]>;
              timestamp: string;
              checksum: number;
            },
          ];
        };
        assert.equal(rawOrderBookMsg.data.length, 1);
        const orderBookMsg: OrderBookMsg = {
          exchange: EXCHANGE_NAME,
          channel: rawOrderBookMsg.table,
          pair: rawOrderBookMsg.data[0].instrument_id.replace('-', '_'),
          timestamp: new Date(rawOrderBookMsg.data[0].timestamp).getTime(),
          raw,
          asks: [],
          bids: [],
          full: rawOrderBookMsg.action === 'partial',
        };
        const parse = (item: [string, string, number]): OrderItem => ({
          price: parseFloat(item[0]),
          quantity: parseFloat(item[1]),
          cost: parseFloat(item[0]) * parseFloat(item[1]),
        });
        orderBookMsg.asks = rawOrderBookMsg.data[0].asks.map(x => parse(x));
        orderBookMsg.bids = rawOrderBookMsg.data[0].bids.map(x => parse(x));
        msgCallback(orderBookMsg);
        break;
      }
      case 'Trade': {
        const rawTradeMsg = rawMsg as {
          table: string;
          data: Array<{
            instrument_id: string;
            price: string;
            side: 'buy' | 'sell';
            size: string;
            timestamp: string;
            trade_id: string;
          }>;
        };
        const tradeMsges: TradeMsg[] = rawTradeMsg.data.map(x => ({
          exchange: EXCHANGE_NAME,
          channel: rawMsg.table,
          pair: x.instrument_id.replace('-', '_'),
          timestamp: new Date(x.timestamp).getTime(),
          raw,
          price: parseFloat(x.price),
          quantity: parseFloat(x.size),
          side: x.side === 'sell',
          trade_id: x.trade_id,
        }));

        tradeMsges.forEach(async tradeMsg => msgCallback(tradeMsg));
        break;
      }
      default:
        logger.error(`Unknown channel: ${obj.ch}`);
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
