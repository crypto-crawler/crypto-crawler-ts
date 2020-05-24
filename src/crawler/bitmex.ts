import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { setTimeout } from 'timers';
import WebSocket from 'ws';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { debug, getChannels, initBeforeCrawl } from './util';

// doc https://www.bitmex.com/app/wsAPI

const EXCHANGE_NAME = 'BitMEX';

const WEBSOCKET_ENDPOINT = 'wss://www.bitmex.com/realtime';

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  const marketsFiltered = markets.filter((x) => x.pair === pair && x.type === marketType);
  assert.ok(
    marketsFiltered.length > 0,
    `${EXCHANGE_NAME} ${marketType} market does NOT have ${pair}`,
  );

  const channelTypeMap: { [key: string]: string } = {
    BBO: 'quote',
    OrderBook: 'orderBookL2_25',
    Trade: 'trade',
  };
  const channel = channelTypeMap[channeltype];
  if (channel === undefined) {
    throw new Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }

  return marketsFiltered.map((market) => `${channel}:${market.id}`);
}

function getChannelType(channel: string): ChannelType {
  const channelTypeMap: { [key: string]: ChannelType } = {
    quote: 'BBO',
    orderBookL2_25: 'OrderBook',
    trade: 'Trade',
  };
  const channelType = channelTypeMap[channel];

  if (channelType === undefined) {
    throw new Error(`Unknown channel: ${channel}`);
  }

  return channelType;
}

export function calcQuantity(market: Market, size: number, price: number): number {
  if (market.base === 'BTC') {
    return size / price;
  }
  if (market.type === 'Swap') {
    return size; // TODO: ETHUSD and XRPUSD are dynamic
  }
  if (market.type === 'Futures') {
    return size;
  }
  return size;
}

// This function re-connects on close.
export function connect(
  url: string,
  onMessage: (data: WebSocket.Data) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscriptions?: readonly { [key: string]: any }[],
): void {
  const websocket = new WebSocket(url);

  let pongTimeout: NodeJS.Timeout;

  let timer: NodeJS.Timeout;

  // see https://www.bitmex.com/app/wsAPI#Heartbeats
  const restartTimer = (): void => {
    // restart the timer
    clearTimeout(timer);
    timer = setTimeout(() => {
      websocket.ping();

      clearTimeout(pongTimeout);
      pongTimeout = setTimeout(() => {
        debug('pong latency more then 5 seconds, now re-connecting');
        connect(url, onMessage, subscriptions);
      }, 5000);
    }, 5000);
  };

  restartTimer();

  websocket.on('open', () => {
    debug(`${websocket.url} connected`);

    if (subscriptions !== undefined) {
      subscriptions.forEach((x) => {
        websocket.send(JSON.stringify(x));
      });
    }
  });

  websocket.on('pong', (data) => {
    debug(data.toString('utf8').length);
    clearTimeout(pongTimeout);

    restartTimer();
  });

  websocket.on('message', (data) => {
    restartTimer();

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

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.ok(['Futures', 'Swap'].includes(marketType), 'BitMEX has only Futures and Swap markets');

  const [markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);
  assert.ok(marketMap);
  assert.ok(msgCallback);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);

  // rawPair -> Map
  const idPriceMaps: { [key: string]: Map<number, number> } = {};

  connect(
    WEBSOCKET_ENDPOINT,
    async (data) => {
      const raw = data as string;
      const obj = JSON.parse(raw);

      if (obj.table === undefined) {
        debug(obj);
        return;
      }

      const channel: string = obj.table;
      const channelType = getChannelType(channel);
      assert.ok(channelType);

      switch (channel) {
        case 'quote': {
          const tmp = obj as {
            table: 'quote';
            action: 'partial' | 'insert';
            data: ReadonlyArray<{
              timestamp: string;
              symbol: string;
              bidSize: number;
              bidPrice: number;
              askPrice: number;
              askSize: number;
            }>;
          };

          const rawBboMsg = tmp.data[tmp.data.length - 1]; // the last element is the newest quote
          const market = marketMap.get(rawBboMsg.symbol)!;

          const msg: BboMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: market.pair,
            rawPair: rawBboMsg.symbol,
            channel,
            channelType,
            timestamp: new Date(rawBboMsg.timestamp).getTime(),
            raw: rawBboMsg,
            bidPrice: rawBboMsg.bidPrice,
            bidQuantity: calcQuantity(market, rawBboMsg.bidSize, rawBboMsg.bidPrice),
            askPrice: rawBboMsg.askPrice,
            askQuantity: calcQuantity(market, rawBboMsg.askSize, rawBboMsg.askPrice),
          };

          msgCallback(msg);
          break;
        }
        case 'orderBookL2_25': {
          const rawOrderBookMsg = obj as {
            table: 'orderBookL2_25';
            action: 'partial' | 'insert' | 'update' | 'delete';
            data: ReadonlyArray<{
              symbol: string;
              id: number;
              side: 'Sell' | 'Buy';
              size: number;
              price?: number;
            }>;
          };

          const rawPair = rawOrderBookMsg.data[0].symbol;
          const market = marketMap.get(rawOrderBookMsg.data[0].symbol)!;

          if (!(rawPair in idPriceMaps)) {
            idPriceMaps[rawPair] = new Map<number, number>();
          }
          const idPriceMap = idPriceMaps[rawPair];

          if (rawOrderBookMsg.action === 'partial') {
            idPriceMap.clear();
          }

          if (rawOrderBookMsg.action === 'insert' || rawOrderBookMsg.action === 'partial') {
            rawOrderBookMsg.data
              .filter((x) => x.price !== undefined)
              .forEach((x) => {
                idPriceMap.set(x.id, x.price!);
              });
          }

          const orderBookMsg: OrderBookMsg = {
            exchange: EXCHANGE_NAME,
            marketType,
            pair: market.pair,
            rawPair,
            channel,
            channelType,
            timestamp: Date.now(),
            raw: rawOrderBookMsg,
            asks: [],
            bids: [],
            full: rawOrderBookMsg.action === 'partial',
          };

          const parse = (item: {
            symbol: string;
            id: number;
            side: 'Sell' | 'Buy';
            size: number;
            price?: number;
          }): OrderItem => {
            assert.ok(idPriceMap.has(item.id));
            const price = idPriceMap.get(item.id)!;

            const quantity =
              rawOrderBookMsg.action === 'delete' ? 0 : calcQuantity(market, item.size, price);
            const cost = quantity * price;

            const result: OrderItem = {
              price,
              quantity,
              cost,
            };
            return result;
          };

          orderBookMsg.asks = rawOrderBookMsg.data
            .filter((x) => x.side === 'Sell' && idPriceMap.has(x.id))
            .map((x) => parse(x));
          orderBookMsg.asks = rawOrderBookMsg.data
            .filter((x) => x.side === 'Buy' && idPriceMap.has(x.id))
            .map((x) => parse(x));

          if (rawOrderBookMsg.action === 'delete') {
            rawOrderBookMsg.data.forEach((x) => {
              idPriceMap.delete(x.id);
            });
          }

          msgCallback(orderBookMsg);
          break;
        }
        case 'trade': {
          const arr = obj.data as ReadonlyArray<{
            timestamp: string;
            symbol: string;
            side: 'Sell' | 'Buy';
            size: number;
            price: number;
            tickDirection: 'MinusTick' | 'PlusTick' | 'ZeroMinusTick' | 'ZeroPlusTick';
            trdMatchID: string;
            grossValue: number;
            homeNotional: number;
            foreignNotional: number;
          }>;

          const tradeMsges: TradeMsg[] = arr.map((rawTradeMsg) => {
            const market = marketMap.get(arr[0].symbol)!;
            assert.ok(market);

            const quantity = rawTradeMsg.homeNotional;
            // rawTradeMsg.foreignNotional === quantity * rawTradeMsg.price
            assert.ok(
              Math.abs(1 - rawTradeMsg.foreignNotional / (quantity * rawTradeMsg.price)) < 0.0001,
            );

            // Check the grossValue field
            if (market.base === 'BTC' || market.quote === 'BTC') {
              assert.equal(
                Math.round(
                  1e8 *
                    (market.base === 'BTC'
                      ? rawTradeMsg.homeNotional
                      : rawTradeMsg.foreignNotional),
                ),
                rawTradeMsg.grossValue,
              );
            }

            // The field size has different meanings
            if (market.type === 'Swap') {
              assert.equal(market.quote, 'USD');
              if (market.base === 'BTC') {
                assert.equal(rawTradeMsg.size, rawTradeMsg.foreignNotional);
              }
            } else if (market.type === 'Futures') {
              if (market.base === 'BTC') {
                assert.equal(rawTradeMsg.size, rawTradeMsg.foreignNotional);
              } else if (market.id !== 'ETHUSDM20') {
                assert.equal(rawTradeMsg.homeNotional, rawTradeMsg.size);
              }
            }

            const tradeMsg: TradeMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: rawTradeMsg.symbol,
              channel,
              channelType,
              timestamp: new Date(rawTradeMsg.timestamp).getTime(),
              raw: rawTradeMsg,
              price: rawTradeMsg.price,
              quantity,
              side: rawTradeMsg.side === 'Sell',
              trade_id: rawTradeMsg.trdMatchID,
            };
            return tradeMsg;
          });

          tradeMsges.forEach((x) => msgCallback(x));
          break;
        }
        default:
          debug(`Unknown channel ${channel}`);
      }

      // msgCallback(obj);
    },
    [{ op: 'subscribe', args: channels }],
  );
}
