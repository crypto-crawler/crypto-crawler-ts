import axios from 'axios';
import assert from 'assert';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';

export default class NewdexMetaInfo extends ExchangeMetaInfo {
  constructor() {
    super(
      'Newdex',
      'https://github.com/newdex/api-docs',
      'wss://ws.newdex.io/',
      'https://api.newdex.io/v1',
    );
  }

  public async getRawPairs(): Promise<Array<string>> {
    const response = await axios.get(`${this.restfulEndpoint}/common/symbols`);
    assert.strictEqual(response.data.code, 200);
    const arr = response.data.data as Array<{
      id: number;
      symbol: string;
      contract: string;
      currency: string;
      price_precision: number;
      currency_precision: number;
      receiver: string;
    }>;
    return arr.map(x => x.symbol);
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPair = this.convertToRawPair(pair);
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `depth.${rawPair}:5`;
      default:
        throw Error(`CrawlType ${crawlType} is not supported for ${this.name} yet`);
    }
  }

  public convertToStandardPair(rawPair: string): string {
    const arr = rawPair.split('-');
    assert(arr.length === 3);
    const from = arr[1];
    const to = arr[2];
    return `${from}_${to}`.toUpperCase();
  }

  public convertToRawPair(pair: string): string {
    const mapping: { [key: string]: string } = {
      EIDOS_EOS: 'eidosonecoin-eidos-eos',
    };
    return mapping[pair];
  }
}
