import assert from 'assert';
import WebSocket from 'ws';
import Crawler, { ProcessMessageCallback } from './crawler';
import CrawlType from './crawl_type';
import { OrderMsg, OrderBookMsg } from '../pojo/msg';
import NewdexMetaInfo from '../exchange/newdex_meta_info';

// API docs: https://github.com/newdex/api-docs
export default class NewdexCrawler extends Crawler {
  constructor(
    crawlTypes: CrawlType[] = [CrawlType.ORDER_BOOK],
    pairs: string[] = [],
    processMsgCallback?: ProcessMessageCallback,
  ) {
    super(new NewdexMetaInfo(), crawlTypes, pairs, processMsgCallback);
  }

  protected async crawl(): Promise<void> {
    const websocket = new WebSocket(this.exchangeMetaInfo.websocketEndpoint);
    websocket.on('open', () => {
      websocket.send(JSON.stringify({ type: 'handshake', version: '1.4' }));
      setInterval(() => {
        websocket.send(JSON.stringify({ type: 'heartbeat' }));
      }, 10000);

      this.getChannels().forEach(channel => {
        websocket.send(
          JSON.stringify({
            channel,
            type: 'subscribe',
          }),
        );
      });
    });

    Crawler.listenWebSocket(
      websocket,
      data => {
        const raw = data as string;
        const rawMsg = JSON.parse(raw);
        switch (rawMsg.type) {
          case 'handshake': {
            this.logger.info('Handshake succeeded!');
            break;
          }
          case 'push': {
            if (rawMsg.channel.startsWith('depth.')) {
              const rawPair = rawMsg.channel.substring('depth.'.length, rawMsg.channel.length - 2);

              const msg = {
                exchange: this.exchangeMetaInfo.name,
                channel: rawMsg.channel,
                pair: this.exchangeMetaInfo.convertToStandardPair(rawPair),
                createdAt: new Date(),
                raw,
                asks: [],
                bids: [],
              } as OrderBookMsg;
              const parseOrder = (text: string): OrderMsg => {
                const arr = text.split(':');
                assert.strictEqual(arr.length, 3);
                const orderMsg = {
                  price: parseFloat(arr[0]),
                  quantity: parseFloat(arr[1]),
                  cost: parseFloat(arr[2]),
                } as OrderMsg;
                return orderMsg;
              };
              rawMsg.data.asks.forEach((text: string) => {
                msg.asks.push(parseOrder(text));
              });
              rawMsg.data.bids.forEach((text: string) => {
                msg.bids.push(parseOrder(text));
              });
              this.processMsgCallback(msg);
            } else {
              this.logger.warn(rawMsg);
            }
            break;
          }
          default: {
            throw Error('Unrecognized type');
          }
        }
      },
      this.logger,
    );
  }
}
