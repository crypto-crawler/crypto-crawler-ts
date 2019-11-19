import assert from 'assert';
import WebSocket from 'ws';
import { Client, IFrame, Message } from '@stomp/stompjs';
import Crawler, { ProcessMessageCallback } from './crawler';
import CrawlType from './crawl_type';
import { OrderMsg, OrderBookMsg, TradeMsg } from '../pojo/msg';
import { WhaleExMetaInfo } from '../exchange';

// see https://github.com/stomp-js/stompjs/issues/28
Object.assign(global, { WebSocket });

// API docs: https://github.com/WhaleEx/API
export default class WhaleExCrawler extends Crawler {
  constructor(
    crawlTypes: CrawlType[] = [CrawlType.ORDER_BOOK],
    pairs: string[] = [],
    processMsgCallback?: ProcessMessageCallback,
  ) {
    super(new WhaleExMetaInfo(), crawlTypes, pairs, processMsgCallback);
  }

  protected async crawl(): Promise<void> {
    const client = new Client({
      brokerURL: this.exchangeMetaInfo.websocketEndpoint,
      connectHeaders: {
        login: 'guest',
        passcode: 'guest',
      },
      heartbeatIncoming: 3000,
      heartbeatOutgoing: 3000,
    });
    client.onConnect = (frame: IFrame) => {
      if (frame.command === 'CONNECTED') {
        this.logger.info('Connected to Stomp successfully!');
      } else {
        throw Error('Error connecting to server!');
      }

      this.crawlTypes.forEach(crawlType => {
        this.pairs.forEach(pair => {
          const channel = this.exchangeMetaInfo.getChannel(crawlType, pair);
          client.subscribe(channel, (message: Message) => {
            assert.strictEqual(message.command, 'MESSAGE');
            assert.strictEqual(channel, message.headers.destination);
            switch (crawlType) {
              case CrawlType.ORDER_BOOK: {
                const rawMsg = JSON.parse(message.body) as {
                  type: string;
                  timestamp: string;
                  symbol: string;
                  asks: string[];
                  bids: string[];
                  [key: string]: any;
                };
                assert.strictEqual(rawMsg.type, 'B');

                const msg = {
                  exchange: this.exchangeMetaInfo.name,
                  channel,
                  pair,
                  timestamp: parseInt(rawMsg.timestamp, 10),
                  raw: message.body,
                  asks: [],
                  bids: [],
                  full: true,
                } as OrderBookMsg;
                const parseOrder = (text: string): OrderMsg => {
                  const arr = text.split(':');
                  assert.strictEqual(arr.length, 2);
                  const orderMsg = {
                    price: parseFloat(arr[0]),
                    quantity: parseFloat(arr[1]),
                    cost: 0,
                  } as OrderMsg;
                  orderMsg.cost = orderMsg.price * orderMsg.quantity;
                  return orderMsg;
                };
                rawMsg.asks.forEach((text: string) => {
                  msg.asks.push(parseOrder(text));
                });
                rawMsg.bids.forEach((text: string) => {
                  msg.bids.push(parseOrder(text));
                });
                this.processMsgCallback(msg);
                break;
              }
              case CrawlType.TRADE: {
                const rawMsg = JSON.parse(message.body) as {
                  type: string;
                  timestamp: string;
                  tradeId: string;
                  symbol: string;
                  price: string;
                  quantity: string;
                  bidAsk: string;
                };
                assert.strictEqual(rawMsg.type, 'T');

                const msg = {
                  exchange: this.exchangeMetaInfo.name,
                  channel,
                  pair,
                  timestamp: parseInt(rawMsg.timestamp, 10),
                  raw: message.body,
                  price: parseFloat(rawMsg.price),
                  quantity: parseFloat(rawMsg.quantity),
                  side: rawMsg.bidAsk === 'A',
                  trade_id: parseInt(rawMsg.tradeId, 10),
                } as TradeMsg;
                this.processMsgCallback(msg);
                break;
              }
              default:
                this.logger.warn(`Unrecognized CrawlType: ${crawlType}`);
                this.logger.warn(message);
                break;
            }
          });
        });
      });
    };

    client.onStompError = (frame: IFrame) => {
      this.logger.error(frame);
    };

    client.activate();
  }
}
