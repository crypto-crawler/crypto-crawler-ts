import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, OrderItem, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, debug, getChannels, initBeforeCrawl } from './util';

// doc: https://docs.kraken.com/websockets/

const EXCHANGE_NAME = 'Kraken';
const WEBSOCKET_ENDPOINT = 'wss://ws.kraken.com';

function getChannel(
  marketType: MarketType,
  channeltype: ChannelType,
  pair: string,
  markets: readonly Market[],
): readonly string[] {
  assert.equal(marketType, 'Spot');
  assert.ok(pair);
  assert.ok(markets);

  switch (channeltype) {
    case 'BBO':
      return ['spread'];
    case 'OrderBook':
      return ['book'];
    case 'Trade':
      return ['trade'];
    default:
      throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
  }
}

function getChannelType(channel: string): ChannelType {
  if (channel.startsWith('book')) return 'OrderBook';
  let result: ChannelType;

  switch (channel) {
    case 'spread':
      result = 'BBO';
      break;
    case 'trade':
      result = 'Trade';
      break;
    default:
      throw Error(`Unknown channel: ${channel}`);
  }
  return result;
}

// wsname -> Market
function buildPairMap(markets: readonly Market[]): Map<string, Market> {
  const result = new Map<string, Market>();
  markets.forEach((market) => {
    result.set(market.info.wsname, market);
  });
  return result;
}

export default async function crawl(
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  assert.equal('Spot', marketType, 'Kraken has only Spot market');

  const [markets] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);
  const marketMap = buildPairMap(markets);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.equal(channels.length, channelTypes.length * pairs.length);

  connect(
    WEBSOCKET_ENDPOINT,
    (data) => {
      const raw = data as string;
      const rawMsg = JSON.parse(raw);
      if (
        rawMsg.event === 'pong' ||
        rawMsg.event === 'systemStatus' ||
        rawMsg.event === 'subscriptionStatus'
      ) {
        debug(rawMsg);
        return;
      }

      if (rawMsg instanceof Array) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr = rawMsg as any[];
        const channel = arr[2] as string;
        const wsname = arr[3] as string;
        const market = marketMap.get(wsname)!;
        assert.equal(market.exchange, EXCHANGE_NAME);
        const channelType = getChannelType(channel);
        switch (channelType) {
          case 'BBO': {
            const rawBboMsg = arr[1] as string[];
            assert.equal(rawBboMsg.length, 5);
            const bboMsg: BboMsg = {
              exchange: EXCHANGE_NAME,
              marketType: 'Spot',
              pair: market.pair,
              rawPair: market.id,
              channel,
              channelType,
              timestamp: Math.floor(parseFloat(rawBboMsg[2]) * 1000),
              raw: rawBboMsg,
              bidPrice: parseFloat(rawBboMsg[0]),
              bidQuantity: parseFloat(rawBboMsg[3]),
              askPrice: parseFloat(rawBboMsg[1]),
              askQuantity: parseFloat(rawBboMsg[4]),
            };

            msgCallback(bboMsg);
            break;
          }
          case 'OrderBook': {
            const parseOrderItem = (orderText: string[]): OrderItem => {
              assert.ok(orderText.length === 3 || orderText.length === 4);
              const orderItem: OrderItem = {
                price: parseFloat(orderText[0]),
                quantity: parseFloat(orderText[1]),
                timestamp: Math.floor(parseFloat(orderText[2]) * 1000),
                cost: 0,
              };
              orderItem.cost = orderItem.price * orderItem.quantity;
              return orderItem;
            };

            if (arr[1].as) {
              const rawFullOrderBookMsg = arr[1] as { as: string[][]; bs: string[][] };
              const orderbook: OrderBookMsg = {
                exchange: EXCHANGE_NAME,
                marketType: 'Spot',
                pair: market.pair,
                rawPair: market.id,
                channel,
                channelType,
                timestamp: Date.now(),
                raw: rawFullOrderBookMsg,
                asks: [],
                bids: [],
                full: true,
              };
              orderbook.asks = rawFullOrderBookMsg.as.map((x) => parseOrderItem(x));
              orderbook.bids = rawFullOrderBookMsg.bs.map((x) => parseOrderItem(x));
              msgCallback(orderbook);
            } else {
              const rawOrderBookUpdateMsg = arr[1] as { a: string[][]; b: string[][] };
              const orderbook: OrderBookMsg = {
                exchange: EXCHANGE_NAME,
                marketType: 'Spot',
                pair: market.pair,
                rawPair: market.id,
                channel,
                channelType,
                timestamp: Date.now(),
                raw: rawOrderBookUpdateMsg,
                asks: [],
                bids: [],
                full: false,
              };
              if (rawOrderBookUpdateMsg.a) {
                orderbook.asks = rawOrderBookUpdateMsg.a.map((x) => parseOrderItem(x));
              }
              if (rawOrderBookUpdateMsg.b) {
                orderbook.bids = rawOrderBookUpdateMsg.b.map((x) => parseOrderItem(x));
              }
              msgCallback(orderbook);
            }
            break;
          }
          case 'Trade': {
            const rawTradeMsgArray = arr[1] as string[][];
            assert.equal(rawTradeMsgArray[0].length, 6);

            rawTradeMsgArray.forEach((rawTradeMsg) => {
              assert.equal(rawTradeMsg.length, 6);
              const msg: TradeMsg = {
                exchange: EXCHANGE_NAME,
                marketType: 'Spot',
                pair: market.pair,
                rawPair: market.id,
                channel,
                channelType,
                timestamp: Math.floor(parseFloat(rawTradeMsg[2]) * 1000),
                raw: rawTradeMsg,
                price: parseFloat(rawTradeMsg[0]),
                quantity: parseFloat(rawTradeMsg[1]),
                side: rawTradeMsg[2] === 's', // s, b
                trade_id: rawTradeMsg[2].replace('.', ''), // use timestamp as trade_id
              };

              msgCallback(msg);
            });
            break;
          }
          default:
            debug(`Unrecognized channel type: ${channelType}`);
        }
      }
    },
    channels.map((channel) => ({
      event: 'subscribe',
      pair: pairs.map(
        (p) => markets.filter((m) => m.type === marketType && m.pair === p)[0].info.wsname,
      ),
      subscription: {
        name: channel,
      },
    })),
  );
}
