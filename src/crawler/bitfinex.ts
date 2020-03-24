import { strict as assert } from 'assert';
import { ExchangeInfo } from 'exchange-info';
import { Logger } from 'winston';
import { ChannelType } from '../pojo/channel_type';
import { OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { initBeforeCrawl } from './util';

/* eslint-disable @typescript-eslint/no-var-requires */
const { WSv2 } = require('bitfinex-api-node');
const { OrderBook } = require('bfx-api-node-models');

const EXCHANGE_NAME = 'Bitfinex';
const NUM_CHANNELS_PER_WS = 30; // This is for error 10305, see https://www.bitfinex.com/posts/381

function getChannel(channeltype: ChannelType): string {
  switch (channeltype) {
    case 'BBO':
    case 'OrderBook':
      return 'book';
    case 'Trade':
      return 'trades';
    case 'Ticker':
      return 'ticker';
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

/**
 * Returns an array with arrays of the given size.
 *
 * @param myArray {Array} array to split
 * @param chunk_size {int} Size of every group
 */
function chunkArray<T>(myArray: T[], chunk_size: number): T[][] {
  let index = 0;
  const arrayLength = myArray.length;
  const tempArray = [];

  for (index = 0; index < arrayLength; index += chunk_size) {
    const myChunk = myArray.slice(index, index + chunk_size);
    // Do something if you want with the group
    tempArray.push(myChunk);
  }

  return tempArray;
}

function connect(
  exchangeInfo: ExchangeInfo,
  logger: Logger,
  msgCallback: MsgCallback,
  arr: { channelType: ChannelType; pair: string }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const ws = new WSv2({ transform: true, autoReconnect: true });

  ws.on('error', (err: Error) => logger.error(err));

  ws.on('open', () => {
    arr.forEach((x) => {
      const { channelType, pair } = x;
      const symbol = exchangeInfo.pairs[pair].raw_pair.toUpperCase();
      switch (channelType) {
        case 'Trade':
          ws.subscribeTrades(symbol);
          break;
        case 'BBO':
          ws.subscribeOrderBook(symbol, 'P0', '1');
          break;
        case 'OrderBook':
          ws.subscribeOrderBook(symbol, 'P0', '25');
          break;
        default:
          throw Error(`Unknown channelType: ${channelType}`);
      }
    });
  });

  arr.forEach((x) => {
    const { channelType, pair } = x;
    const symbol = `t${exchangeInfo.pairs[pair].raw_pair.toUpperCase()}`;
    const channel = getChannel(channelType);

    switch (channelType) {
      case 'Trade': {
        const parse = (trade: {
          id: number;
          mts: number;
          amount: number;
          price: number;
        }): TradeMsg => ({
          exchange: exchangeInfo.name,
          marketType: 'Spot',
          pair,
          rawPair: exchangeInfo.pairs[pair].raw_pair,
          channel,
          channelType,
          timestamp: trade.mts,
          raw: JSON.stringify(trade),
          price: trade.price,
          quantity: Math.abs(trade.amount),
          side: trade.amount < 0,
          trade_id: trade.id.toString(),
        });

        ws.onTrades(
          { symbol },
          (trades: { id: number; mts: number; amount: number; price: number }[]) => {
            const tradeMsges = trades.map(parse);
            tradeMsges.forEach(async (tradeMsg) => msgCallback(tradeMsg));
          },
        );
        ws.onTradeEntry(
          { symbol },
          (trades: { id: number; mts: number; amount: number; price: number }[]) => {
            const tradeMsges = trades.map(parse);
            tradeMsges.forEach(async (tradeMsg) => msgCallback(tradeMsg));
          },
        );
        break;
      }
      case 'BBO':
      case 'OrderBook': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.onOrderBook({ symbol, prec: 'P0' }, (orderbook: any) => {
          assert.ok(orderbook instanceof OrderBook);
          assert.ok(!orderbook.raw);

          const parse = (nums: number[]): OrderItem => {
            assert.equal(nums.length, 3);
            // quantity 0 means delete
            const quantity = nums[1] > 0 ? Math.abs(nums[2]) : 0;
            const cost = nums[0] * quantity;

            return {
              price: nums[0],
              quantity,
              cost,
            };
          };

          const orderBookMsg: OrderBookMsg = {
            exchange: exchangeInfo.name,
            marketType: 'Spot',
            pair,
            rawPair: exchangeInfo.pairs[pair].raw_pair,
            channel,
            channelType,
            timestamp: Date.now(),
            raw: orderbook.serialize(),
            asks: orderbook.asks.map(parse),
            bids: orderbook.bids.map(parse),
            full: orderbook.asks.length === 25 && orderbook.bids.length === 25,
          };

          msgCallback(orderBookMsg);
        });
        break;
      }
      default:
        throw Error(`Unknown channelType: ${channelType}`);
    }
  });

  return ws;
}

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo] = await initBeforeCrawl(EXCHANGE_NAME, pairs);

  const arr: { channelType: ChannelType; pair: string }[] = [];
  pairs.forEach((pair) => {
    channelTypes.forEach((channelType) => {
      arr.push({ channelType, pair });
    });
  });

  const groups = chunkArray<{ channelType: ChannelType; pair: string }>(arr, NUM_CHANNELS_PER_WS);

  const wsClients = groups.map((g) => connect(exchangeInfo, logger, msgCallback, g));

  await Promise.all(wsClients.map((ws) => ws.open()));
}
