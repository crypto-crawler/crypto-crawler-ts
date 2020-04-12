import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import Pako from 'pako';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, debug, getChannels, initBeforeCrawl } from './util';

const EXCHANGE_NAME = 'Huobi';

const WEBSOCKET_ENDPOINTS: { [key: string]: string } = {
  Spot: 'wss://api.huobi.pro/ws',
  Futures: 'wss://www.hbdm.com/ws',
  Swap: 'wss://api.hbdm.com/swap-ws',
};

const contractTypes: { [key: string]: string } = {
  this_week: 'CW',
  next_week: 'NW',
  quarter: 'CQ',
};

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
  if (marketType === 'Spot') {
    assert.equal(
      marketsFiltered.length,
      1,
      `${EXCHANGE_NAME} ${marketType} market has more than one ${pair}`,
    );
  }

  const result: string[] = marketsFiltered.map((market) => {
    assert.equal(market.exchange, EXCHANGE_NAME);
    const rawPair =
      market.type === 'Futures'
        ? `${market.base}_${contractTypes[market.info.contract_type]}`
        : market.id;
    switch (channeltype) {
      case 'BBO':
        return marketType === 'Spot' ? `market.${rawPair}.bbo` : `market.${rawPair}.depth.step6`;
      case 'OrderBook':
        return `market.${rawPair}.depth.step0`;
      case 'Trade':
        return `market.${rawPair}.trade.detail`;
      default:
        throw Error(`ChannelType ${channeltype} is not supported for ${EXCHANGE_NAME} yet`);
    }
  });

  return result;
}

function getChannelType(channel: string): ChannelType {
  const suffix = channel.split('.')[2];
  let result: ChannelType;
  switch (suffix) {
    case 'bbo':
      result = 'BBO';
      break;
    case 'depth':
      result = channel.endsWith('step0') ? 'OrderBook' : 'BBO';
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
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [markets, marketMap] = await initBeforeCrawl(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannels(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  if (marketType === 'Spot' || marketType === 'Swap') {
    assert.equal(channels.length, channelTypes.length * pairs.length);
  }

  const marketMapFutures = new Map<string, Market>();
  if (marketType === 'Futures') {
    markets
      .filter((x) => x.type === 'Futures')
      .forEach((market) => {
        const rawPair = `${market.base}_${contractTypes[market.info.contract_type]}`;
        marketMapFutures.set(rawPair, market);
      });
  }

  connect(
    WEBSOCKET_ENDPOINTS[marketType],
    (data) => {
      const raw = Pako.ungzip(data as pako.Data, { to: 'string' });
      const obj = JSON.parse(raw);
      if (!obj.tick) {
        if (obj.status === 'ok') debug(obj);
        else debug(obj);
        return;
      }
      if (obj.ts && obj.ch && obj.tick) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawMsg = obj as { ch: string; ts: number; tick: { [key: string]: any } };
        const channelType = getChannelType(rawMsg.ch);
        switch (channelType) {
          case 'BBO': {
            if (marketType === 'Spot') {
              const rawBboMsg = rawMsg.tick as {
                symbol: string;
                quoteTime: string;
                bid: string;
                bidSize: string;
                ask: string;
                askSize: string;
              };
              const bboMsg: BboMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair: marketMap.get(rawBboMsg.symbol)!.pair,
                rawPair: rawBboMsg.symbol,
                channel: rawMsg.ch,
                channelType,
                timestamp: rawMsg.ts,
                raw: rawMsg,
                bidPrice: parseFloat(rawBboMsg.bid),
                bidQuantity: parseFloat(rawBboMsg.bidSize),
                askPrice: parseFloat(rawBboMsg.ask),
                askQuantity: parseFloat(rawBboMsg.askSize),
              };

              msgCallback(bboMsg);
            } else {
              const rawOrderBookMsg = rawMsg.tick as {
                bids: number[][];
                asks: number[][];
                version: number;
                ts: number;
                seqNum?: number;
                prevSeqNum?: number;
              };
              const rawPair = rawMsg.ch.split('.')[1];
              const market = marketMapFutures.get(rawPair)!;

              const bboMsg: BboMsg = {
                exchange: EXCHANGE_NAME,
                marketType,
                pair: market.pair,
                rawPair: market.id,
                channel: rawMsg.ch,
                channelType,
                timestamp: rawMsg.ts,
                raw: rawMsg,
                bidPrice: rawOrderBookMsg.bids[0][0],
                bidQuantity: rawOrderBookMsg.bids[0][1],
                askPrice: rawOrderBookMsg.asks[0][0],
                askQuantity: rawOrderBookMsg.asks[0][1],
              };

              msgCallback(bboMsg);
            }

            break;
          }
          case 'OrderBook': {
            const rawOrderBookMsg = rawMsg.tick as {
              bids: number[][];
              asks: number[][];
              version: number;
              ts: number;
              seqNum?: number;
              prevSeqNum?: number;
            };
            const rawPair = rawMsg.ch.split('.')[1];
            const market =
              marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;
            const orderBookMsg: OrderBookMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: rawMsg.ts,
              raw: rawMsg,
              asks: [],
              bids: [],
              full: rawOrderBookMsg.seqNum === undefined,
            };
            orderBookMsg.asks = rawOrderBookMsg.asks.map((x) => ({
              price: x[0],
              quantity: x[1],
              cost: x[0] * x[1],
            }));
            orderBookMsg.bids = rawOrderBookMsg.bids.map((x) => ({
              price: x[0],
              quantity: x[1],
              cost: x[0] * x[1],
            }));
            msgCallback(orderBookMsg);
            break;
          }
          case 'Trade': {
            const rawTradeMsg = rawMsg.tick as {
              id: number;
              ts: number;
              data: Array<{
                amount: number;
                ts: number;
                id: number;
                tradeId: number;
                price: number;
                direction: 'buy' | 'sell';
              }>;
            };
            const rawPair = rawMsg.ch.split('.')[1];
            const market =
              marketType === 'Futures' ? marketMapFutures.get(rawPair)! : marketMap.get(rawPair)!;
            const tradeMsges: TradeMsg[] = rawTradeMsg.data.map((x) => ({
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: x.ts,
              raw: x,
              price: x.price,
              quantity: x.amount,
              side: x.direction === 'sell',
              trade_id: (marketType === 'Spot' ? x.tradeId : x.id).toString(),
            }));

            tradeMsges.forEach(async (tradeMsg) => msgCallback(tradeMsg));
            break;
          }
          default:
            debug(`Unknown channel: ${obj.ch}`);
        }
      } else {
        debug(obj);
      }
    },
    channels.map((channel) => ({ sub: channel, id: 'crypto-crawler', zip: 1 })),
  );
}
