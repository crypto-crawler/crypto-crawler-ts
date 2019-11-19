import assert from 'assert';
import WebSocket from 'ws';
import Crawler, { ProcessMessageCallback } from './crawler';
import CrawlType from './crawl_type';
import { OrderMsg, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { BinanceMetaInfo } from '../exchange';

export default class BinanceCrawler extends Crawler {
  constructor(
    crawlTypes: CrawlType[] = [CrawlType.ORDER_BOOK],
    pairs: string[] = [],
    processMsgCallback?: ProcessMessageCallback,
  ) {
    super(new BinanceMetaInfo(), crawlTypes, pairs, processMsgCallback);
  }

  protected async crawl(): Promise<void> {
    const channels = this.getChannels();
    assert.strictEqual(channels.length > 0, true);
    const websocketUrl = `${this.exchangeMetaInfo.websocketEndpoint}/stream?streams=${channels.join(
      '/',
    )}`;
    const websocket = new WebSocket(websocketUrl);
    Crawler.listenWebSocket(
      websocket,
      data => {
        const rawMsg: { stream: string; data: { [key: string]: any } } = JSON.parse(data as string);
        const crawlType = BinanceCrawler.getCrawlType(rawMsg.stream);
        switch (crawlType) {
          case CrawlType.ORDER_BOOK: {
            const rawOrderbookMsg = rawMsg.data as {
              e: string;
              E: number;
              s: string;
              U: number;
              u: number;
              b: Array<Array<string>>;
              a: Array<Array<string>>;
            };
            assert.strictEqual(rawOrderbookMsg.e, 'depthUpdate');
            const msg: OrderBookMsg = {
              exchange: this.exchangeMetaInfo.name,
              channel: rawMsg.stream,
              pair: this.exchangeMetaInfo.convertToStandardPair(rawOrderbookMsg.s),
              timestamp: rawOrderbookMsg.E,
              raw: data as string,
              asks: [],
              bids: [],
              full: false,
            };
            const parseOrder = (arr: Array<string>): OrderMsg => {
              assert.strictEqual(arr.length, 2);
              const orderMsg = {
                price: parseFloat(arr[0]),
                quantity: parseFloat(arr[1]),
                cost: 0,
              } as OrderMsg;
              orderMsg.cost = orderMsg.price * orderMsg.quantity;
              return orderMsg;
            };
            rawOrderbookMsg.a.forEach((text: Array<string>) => {
              msg.asks.push(parseOrder(text));
            });
            rawOrderbookMsg.b.forEach((text: Array<string>) => {
              msg.bids.push(parseOrder(text));
            });
            this.processMsgCallback(msg);
            break;
          }
          case CrawlType.TRADE: {
            const rawTradeMsg = rawMsg.data as {
              e: string;
              E: number;
              s: string;
              t: number;
              p: string;
              q: string;
              b: number;
              a: number;
              T: number;
              m: boolean;
              M: boolean;
            };
            assert.strictEqual(rawTradeMsg.e, 'trade');
            const msg: TradeMsg = {
              exchange: this.exchangeMetaInfo.name,
              channel: rawMsg.stream,
              pair: this.exchangeMetaInfo.convertToStandardPair(rawTradeMsg.s),
              timestamp: rawTradeMsg.T,
              raw: data as string,
              price: parseFloat(rawTradeMsg.p),
              quantity: parseFloat(rawTradeMsg.q),
              side: rawTradeMsg.m === false,
              trade_id: rawTradeMsg.t,
            };
            this.processMsgCallback(msg);
            break;
          }
          default:
            this.logger.warn(`Unrecognized CrawlType: ${crawlType}`);
            this.logger.warn(rawMsg);
        }
      },
      this.logger,
    );
  }

  private static getCrawlType(channel: string) {
    assert.strictEqual(channel.includes('@'), true);
    const suffix = channel.split('@')[1];
    let result: CrawlType;
    switch (suffix) {
      case 'trade':
        result = CrawlType.TRADE;
        break;
      case 'depth':
        result = CrawlType.ORDER_BOOK;
        break;
      default:
        throw Error(`Unknown channel: ${channel}`);
    }
    return result;
  }
}
