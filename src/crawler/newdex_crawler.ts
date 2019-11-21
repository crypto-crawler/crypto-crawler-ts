import assert from 'assert';
import WebSocket from 'ws';
import Crawler, { ProcessMessageCallback } from './crawler';
import CrawlType from './crawl_type';
import { OrderMsg, OrderBookMsg } from '../pojo/msg';
import NewdexMetaInfo from '../exchange/newdex_meta_info';

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
    });

    Crawler.listenWebSocket(
      websocket,
      data => {
        const raw = data as string;
        const rawMsg = JSON.parse(raw) as { type: string; [key: string]: any };
        switch (rawMsg.type) {
          case 'handshake': {
            this.logger.info('Handshake succeeded!');

            this.getChannels().forEach(channel => {
              websocket.send(
                JSON.stringify({
                  channel,
                  type: 'subscribe',
                }),
              );
            });

            const handshakeData = rawMsg as {
              type: string;
              data: { version: number; heartbeat: { interval: number } };
            };
            setInterval(() => {
              websocket.send(JSON.stringify({ type: 'heartbeat' }));
            }, handshakeData.data.heartbeat.interval * 1000);
            break;
          }
          case 'push': {
            if (rawMsg.channel.startsWith('depth.')) {
              const rawOrderBookMsg = rawMsg as {
                type: string;
                channel: string;
                data: { asks: string[]; bids: string[]; full: number };
              };
              const rawPair = rawOrderBookMsg.channel.substring(
                'depth.'.length,
                rawOrderBookMsg.channel.length - 2,
              );

              const msg = {
                exchange: this.exchangeMetaInfo.name,
                channel: rawOrderBookMsg.channel,
                pair: this.exchangeMetaInfo.convertToStandardPair(rawPair),
                timestamp: new Date().getTime(),
                raw,
                asks: [],
                bids: [],
                full: rawOrderBookMsg.data.full === 1,
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
              rawOrderBookMsg.data.asks.reverse().forEach(text => {
                msg.asks.push(parseOrder(text));
              });
              rawOrderBookMsg.data.bids.forEach(text => {
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
