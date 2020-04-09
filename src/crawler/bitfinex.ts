import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { Logger } from 'winston';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { initBeforeCrawl } from './util';

/* eslint-disable @typescript-eslint/no-var-requires */
const { WSv2 } = require('bitfinex-api-node');
const { OrderBook, PublicTrade } = require('bfx-api-node-models');

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
  markets: readonly Market[],
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
      const symbol = markets
        .filter((m) => m.type === 'Spot' && m.pair === pair)[0]
        .id.toUpperCase();
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
    const market = markets.filter((m) => m.type === 'Spot' && m.pair === pair)[0];
    assert.ok(market);
    assert.equal(market.exchange, EXCHANGE_NAME);
    assert.equal(pair, market.pair);
    const symbol = `t${market.id.toUpperCase()}`;
    const channel = getChannel(channelType);

    switch (channelType) {
      case 'Trade': {
        const parse = (trade: {
          id: number;
          mts: number;
          amount: number;
          price: number;
        }): TradeMsg => ({
          exchange: EXCHANGE_NAME,
          marketType: 'Spot',
          pair,
          rawPair: market.id,
          channel,
          channelType,
          timestamp: trade.mts,
          raw: trade instanceof PublicTrade ? (trade as any).serialize() : trade, // eslint-disable-line @typescript-eslint/no-explicit-any
          price: trade.price,
          quantity: Math.abs(trade.amount),
          side: trade.amount < 0,
          trade_id: trade.id.toString(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.onTrades({ symbol }, async (trades: any) => {
          assert.ok(trades instanceof PublicTrade);
          if (trades.length) {
            for (let i = 0; i < trades.length; i += 1) {
              await msgCallback(parse(trades[i])); // eslint-disable-line no-await-in-loop
            }
          } else {
            await msgCallback(parse(trades));
          }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.onTradeEntry({ symbol }, async (trades: any) => {
          assert.ok(trades instanceof PublicTrade);
          if (trades.length) {
            for (let i = 0; i < trades.length; i += 1) {
              await msgCallback(parse(trades[i])); // eslint-disable-line no-await-in-loop
            }
          } else {
            await msgCallback(parse(trades));
          }
        });
        break;
      }
      case 'BBO':
      case 'OrderBook': {
        let lastBidPrice = 0;
        let lastBidQuantity = 0;
        let lastAskPrice = 0;
        let lastAskQuantity = 0;

        let first = true;
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
            exchange: EXCHANGE_NAME,
            marketType: 'Spot',
            pair,
            rawPair: market.id,
            channel,
            channelType,
            timestamp: Date.now(),
            raw: orderbook.serialize(),
            asks: orderbook.asks.map(parse),
            bids: orderbook.bids.map(parse),
            full: first,
          };
          first = false;

          if (channelType === 'OrderBook') {
            msgCallback(orderBookMsg);
          } else {
            const bboMsg: BboMsg = {
              exchange: EXCHANGE_NAME,
              marketType: 'Spot',
              pair,
              rawPair: market.id,
              channel,
              channelType,
              timestamp: Date.now(),
              raw: orderbook.serialize(),
              bidPrice: lastBidPrice,
              bidQuantity: lastBidQuantity,
              askPrice: lastAskPrice,
              askQuantity: lastAskQuantity,
            };

            if (orderBookMsg.bids.length > 0 || orderBookMsg.asks.length > 0) {
              if (orderBookMsg.bids.length > 0) {
                bboMsg.bidPrice = orderBookMsg.bids[0].price;
                bboMsg.bidQuantity = orderBookMsg.bids[0].quantity;
                lastBidPrice = orderBookMsg.bids[0].price;
                lastBidQuantity = orderBookMsg.bids[0].quantity;
              }
              if (orderBookMsg.asks.length > 0) {
                bboMsg.askPrice = orderBookMsg.asks[0].price;
                bboMsg.askQuantity = orderBookMsg.asks[0].quantity;
                lastAskPrice = orderBookMsg.asks[0].price;
                lastAskQuantity = orderBookMsg.asks[0].quantity;
              }
              msgCallback(bboMsg);
            }
          }
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
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.equal(marketType, 'Spot');
  const [logger, markets] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const arr: { channelType: ChannelType; pair: string }[] = [];
  pairs.forEach((pair) => {
    channelTypes.forEach((channelType) => {
      arr.push({ channelType, pair });
    });
  });

  const groups = chunkArray<{ channelType: ChannelType; pair: string }>(arr, NUM_CHANNELS_PER_WS);

  const wsClients = groups.map((g) => connect(markets, logger, msgCallback, g));

  await Promise.all(wsClients.map((ws) => ws.open()));
}
