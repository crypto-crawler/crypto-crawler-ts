import axios from 'axios';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';
import { RawPairInfo } from '../pojo';

export default class BinanceMetaInfo extends ExchangeMetaInfo {
  constructor() {
    super(
      'Binance',
      'https://github.com/binance-exchange/binance-official-api-docs',
      'wss://stream.binance.com:9443',
      'https://api.binance.com',
    );
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPair = this.standardToRawPair.get(pair)!.toLowerCase();
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `${rawPair}@depth`;
      case CrawlType.TRADE:
        return `${rawPair}@trade`;
      default:
        throw Error(`CrawlType ${crawlType} is not supported for ${this.name} yet`);
    }
  }

  protected async getRawPairsInfo(): Promise<RawPairInfo[]> {
    const response = await axios.get(`${this.restfulEndpoint}/api/v3/exchangeInfo`);
    const arr = response.data.symbols as Array<{
      symbol: string;
      status: string;
      baseAsset: string;
      quoteAsset: string;
      [key: string]: any;
    }>;
    return arr.filter(x => x.status === 'TRADING');
  }

  protected extractStandardPair(rawPair: RawPairInfo): string {
    return `${rawPair.baseAsset}_${rawPair.quoteAsset}`;
  }
}
