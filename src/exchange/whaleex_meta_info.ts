import assert from 'assert';
import axios from 'axios';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';

export default class WhaleExMetaInfo extends ExchangeMetaInfo {
  constructor() {
    super(
      'WhaleEx',
      'https://github.com/WhaleEx/API',
      'wss://www.whaleex.com/ws/websocket',
      'https://api.whaleex.com',
    );
  }

  public async getRawPairs(): Promise<Array<string>> {
    const response = await axios.get(`${this.restfulEndpoint}/BUSINESS/api/public/symbol`);
    const arr = response.data as Array<{
      id: number;
      name: string;
      baseCurrency: string;
      quoteCurrency: string;
      baseVolume: string;
      priceChangePercent: string;
      enable: boolean;
      [key: string]: any;
    }>;
    return arr
      .filter(
        x => x.enable && parseFloat(x.baseVolume) > 0 && parseFloat(x.priceChangePercent) !== 0,
      )
      .map(x => x.name);
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPair = this.convertToRawPair(pair);
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `/${rawPair}@depth20`;
      case CrawlType.TRADE:
        return `/${rawPair}@trade`;
      default:
        throw Error(`CrawlType ${crawlType} is not supported for ${this.name} yet`);
    }
  }

  public convertToStandardPair(rawPair: string): string {
    const QUOTE_CURRENCIES = ['EOS', 'USDT', 'BTC', 'PAX'];
    for (let i = 0; i < QUOTE_CURRENCIES.length; i += 1) {
      const quoteCurrency = QUOTE_CURRENCIES[i];
      if (rawPair.endsWith(quoteCurrency)) {
        return `${rawPair.substring(0, rawPair.length - quoteCurrency.length)}_${quoteCurrency}`;
      }
    }
    throw Error(`Unknown rawPair: ${rawPair}`);
  }

  public convertToRawPair(pair: string): string {
    assert.strictEqual(pair.includes('_'), true);
    return pair.replace(/_/g, '');
  }
}
