import assert from 'assert';
import axios from 'axios';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';

export default class BinanceMetaInfo extends ExchangeMetaInfo {
  constructor() {
    super(
      'Binance',
      'https://github.com/binance-exchange/binance-official-api-docs',
      'wss://stream.binance.com:9443',
      'https://api.binance.com',
    );
  }

  public async getRawPairs(): Promise<Array<string>> {
    const response = await axios.get(`${this.restfulEndpoint}/api/v3/exchangeInfo`);
    const arr = response.data.symbols as Array<{
      symbol: string;
      status: string;
      baseAsset: string;
      quoteAsset: string;
      [key: string]: any;
    }>;
    const set = new Set<string>();
    arr
      .filter(x => x.symbol === 'TRADING')
      .forEach(x => {
        set.add(x.quoteAsset);
      });
    console.dir(set);
    return arr.filter(x => x.symbol === 'TRADING').map(x => `${x.baseAsset}_${x.quoteAsset}`);
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPair = this.convertToRawPair(pair);
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `${rawPair}@depth`;
      case CrawlType.TRADE:
        return `${rawPair}@trade`;
      default:
        throw Error(`CrawlType ${crawlType} is not supported for ${this.name} yet`);
    }
  }

  public convertToStandardPair(rawPair: string): string {
    if (rawPair.endsWith('USDT')) {
      return `${rawPair.substring(0, rawPair.length - 4)}_USDT`;
    }
    return `${rawPair.substring(0, rawPair.length - 3)}_${rawPair.substring(rawPair.length - 3)}`;
  }

  public convertToRawPair(pair: string): string {
    assert.strictEqual(pair.includes('_'), true);
    return pair.replace(/_/g, '').toLowerCase();
  }
}
