import { strict as assert } from 'assert';
import { OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { ChannelType, defaultMsgCallback, MsgCallback } from './index';
import { initBeforeCrawl } from './util';

const { WSv2 } = require('bitfinex-api-node');
const { OrderBook } = require('bfx-api-node-models');

const EXCHANGE_NAME = 'Bitfinex';

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

export default async function crawl(
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, exchangeInfo] = await initBeforeCrawl(EXCHANGE_NAME, pairs);
  assert.equal(exchangeInfo.name, EXCHANGE_NAME);
  assert.ok(msgCallback);

  const symbols = pairs.map(x => exchangeInfo.pairs[x].raw_pair.toUpperCase());

  const ws = new WSv2({ transform: true, autoReconnect: true });

  ws.on('error', (err: Error) => logger.error(err));

  ws.on('open', () => {
    symbols.forEach(symbol => {
      if (channelTypes.includes('Trade')) {
        ws.subscribeTrades(symbol);
      }
      if (channelTypes.includes('BBO')) {
        ws.subscribeOrderBook(symbol, 'P0', '1');
      }
      if (channelTypes.includes('OrderBook')) {
        ws.subscribeOrderBook(symbol, 'P0', '25');
      }
    });
  });

  pairs.forEach(pair => {
    const symbol = `t${exchangeInfo.pairs[pair].raw_pair.toUpperCase()}`;
    channelTypes.forEach(channelType => {
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
            channel,
            pair,
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
              tradeMsges.forEach(async tradeMsg => msgCallback(tradeMsg));
            },
          );
          ws.onTradeEntry(
            { symbol },
            (trades: { id: number; mts: number; amount: number; price: number }[]) => {
              const tradeMsges = trades.map(parse);
              tradeMsges.forEach(async tradeMsg => msgCallback(tradeMsg));
            },
          );
          break;
        }
        case 'BBO':
        case 'OrderBook': {
          ws.onOrderBook({ symbol, prec: 'P0' }, (orderbook: any) => {
            assert.ok(orderbook instanceof OrderBook);
            assert.ok(!orderbook.raw);

            const parse = (arr: number[]): OrderItem => {
              assert.equal(arr.length, 3);
              // quantity 0 means delete
              const quantity = arr[1] > 0 ? Math.abs(arr[2]) : 0;
              const cost = arr[0] * quantity;

              return {
                price: arr[0],
                quantity,
                cost,
              };
            };

            const orderBookMsg: OrderBookMsg = {
              exchange: exchangeInfo.name,
              channel,
              pair,
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
  });

  ws.open();
}
