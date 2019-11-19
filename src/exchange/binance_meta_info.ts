import assert from 'assert';
import axios from 'axios';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';
import convertToStandardPair from '../util/common';

export default class BinanceMetaInfo extends ExchangeMetaInfo {
  private static QUOTE_CURRENCIES = [
    'BTC',
    'ETH',
    'USDT',
    'BNB',
    'TUSD',
    'PAX',
    'USDC',
    'XRP',
    'USDS',
    'TRX',
    'BUSD',
    'NGN',
  ];

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
    return arr.filter(x => x.status === 'TRADING').map(x => `${x.baseAsset}_${x.quoteAsset}`);
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
    return convertToStandardPair(rawPair, BinanceMetaInfo.QUOTE_CURRENCIES);
  }

  public convertToRawPair(pair: string): string {
    assert.strictEqual(pair.includes('_'), true);
    return pair.replace(/_/g, '').toLowerCase();
  }
}
