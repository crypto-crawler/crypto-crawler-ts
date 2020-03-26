import { strict as assert } from 'assert';
import { Market, MarketType } from 'crypto-markets';
import Pako from 'pako';
import { ChannelType } from '../pojo/channel_type';
import { BboMsg, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { defaultMsgCallback, MsgCallback } from './index';
import { connect, getChannelsNew, initBeforeCrawlNew } from './util';

const EXCHANGE_NAME = 'Huobi';

const WEBSOCKET_ENDPOINTS: { [key: string]: string } = {
  Spot: 'wss://api.huobi.pro/ws',
  Futures: 'wss://www.hbdm.com/ws',
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
  const marketsFiltered = markets.filter((x) => x.pair === pair && x.marketType === marketType);
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
    const rawPair =
      market.marketType === 'Spot'
        ? market.id.toLowerCase()
        : `${market.base}_${contractTypes[market.info.contract_type]}`;
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
  assert.ok(channel.includes(''));
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
  channelTypes: ChannelType[],
  pairs: string[] = [],
  msgCallback: MsgCallback = defaultMsgCallback,
): Promise<void> {
  const [logger, markets, marketMap] = await initBeforeCrawlNew(EXCHANGE_NAME, pairs, marketType);

  const channels = getChannelsNew(marketType, channelTypes, pairs, markets, getChannel);
  assert.ok(channels.length > 0);
  if (marketType === 'Spot') {
    assert.equal(channels.length, 1);
  } else if (marketType === 'Futures') {
    assert.equal(channels.length, 3);
  }

  const marketMapFutures = new Map<string, Market>();
  if (marketType === 'Futures') {
    markets
      .filter((x) => x.marketType === 'Futures')
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
        if (obj.status === 'ok') logger.info(obj);
        else logger.warn(obj);
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
                raw,
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
                raw,
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
              marketType === 'Spot' ? marketMap.get(rawPair)! : marketMapFutures.get(rawPair)!;
            const orderBookMsg: OrderBookMsg = {
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: rawMsg.ts,
              raw,
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
              marketType === 'Spot' ? marketMap.get(rawPair)! : marketMapFutures.get(rawPair)!;
            const tradeMsges: TradeMsg[] = rawTradeMsg.data.map((x) => ({
              exchange: EXCHANGE_NAME,
              marketType,
              pair: market.pair,
              rawPair: market.id,
              channel: rawMsg.ch,
              channelType,
              timestamp: x.ts,
              raw: JSON.stringify(x),
              price: x.price,
              quantity: x.amount,
              side: x.direction === 'sell',
              trade_id: x.id.toString(), // TODO: bignumber
            }));

            tradeMsges.forEach(async (tradeMsg) => msgCallback(tradeMsg));
            break;
          }
          default:
            logger.error(`Unknown channel: ${obj.ch}`);
        }
      } else {
        logger.warn(obj);
      }
    },
    channels.map((channel) => ({ sub: channel, id: 'crypto-crawler', zip: 1 })),
    logger,
  );
}
