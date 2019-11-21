import axios from 'axios';
import ExchangeMetaInfo from './exchange_meta_info';
import CrawlType from '../crawler/crawl_type';
import { RawPairInfo } from '../pojo';

export default class WhaleExMetaInfo extends ExchangeMetaInfo {
  constructor() {
    super(
      'WhaleEx',
      'https://github.com/WhaleEx/API',
      'wss://www.whaleex.com/ws/websocket',
      'https://api.whaleex.com',
    );
  }

  public getChannel(crawlType: CrawlType, pair: string): string {
    const rawPair = this.standardToRawPair.get(pair)!;
    switch (crawlType) {
      case CrawlType.ORDER_BOOK:
        return `/${rawPair}@depth5`;
      case CrawlType.TRADE:
        return `/${rawPair}@trade`;
      default:
        throw Error(`CrawlType ${crawlType} is not supported for ${this.name} yet`);
    }
  }

  protected async getRawPairsInfo(): Promise<RawPairInfo[]> {
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
    return arr.filter(
      x => x.enable && parseFloat(x.baseVolume) > 0 && parseFloat(x.priceChangePercent) !== 0,
    );
  }

  protected extractStandardPair(rawPair: RawPairInfo): string {
    return `${rawPair.baseCurrency}_${rawPair.quoteCurrency}`;
  }

  protected extractRawPair(rawPairInfo: RawPairInfo): string {
    return rawPairInfo.name;
  }
}
