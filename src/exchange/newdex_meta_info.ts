import axios from 'axios';
import assert from 'assert';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';
import { RawPairInfo } from '../pojo';

export default class NewdexMetaInfo extends ExchangeMetaInfo {
  constructor() {
    super(
      'Newdex',
      'https://github.com/newdex/api-docs',
      'wss://ws.newdex.io/',
      'https://api.newdex.io/v1',
    );
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPairInfo = this.pairMap.get(pair)!;
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `depth.${rawPairInfo.symbol}:${rawPairInfo.price_precision}`;
      default:
        throw Error(`CrawlType ${crawlType} is not supported for ${this.name} yet`);
    }
  }

  protected async getRawPairsInfo(): Promise<RawPairInfo[]> {
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
    return arr;
  }

  protected extractStandardPair(rawPair: RawPairInfo): string {
    const arr = rawPair.symbol.split('-');
    assert(arr.length === 3);
    const from = arr[1];
    const to = arr[2];
    return `${from}_${to}`.toUpperCase();
  }
}
