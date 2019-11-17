import assert from 'assert';
import ExchangeMetaInfoBase from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';

export default class NewdexMetaInfo extends ExchangeMetaInfoBase {
  constructor() {
    super('newdex', 'wss://ws.newdex.io/', 'https://api.newdex.io/v1');
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPair = this.convertToRawPair(pair);
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `depth.${rawPair}:5`;
      default:
        break;
    }
    return '';
  }

  protected channelToPair(channel: string): string {
    if (channel === 'depth.eidosonecoin-eidos-eos:5') {
      return 'EIDOS_EOS';
    }
    return '';
  }

  public async getRawPairs(): Promise<Array<string>> {
    return ['eidosonecoin-eidos-eos'];
  }

  public convertToStandardPair(rawPair: string): string {
    const arr = rawPair.split('-');
    assert(arr.length === 3);
    const from = arr[1];
    const to = arr[2];
    return `${from}/${to}`.toUpperCase();
  }

  public convertToRawPair(pair: string): string {
    const mapping: { [key: string]: string } = {
      EIDOS_EOS: 'eidosonecoin-eidos-eos',
    };
    return mapping[pair];
  }
}
