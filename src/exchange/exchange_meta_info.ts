/* eslint-disable camelcase */
import CrawlType from '../crawler/crawl_type';
import { RawPairInfo } from '../pojo';

// Ground truth of an exchange
export default abstract class ExchangeMetaInfo {
  name: string;

  docUrl: string;

  websocketEndpoint: string;

  restfulEndpoint: string;

  // standard -> RawPairInfo
  protected pairMap = new Map<string, RawPairInfo>();

  protected rawToStandardPair = new Map<string, string>();

  protected standardToRawPair = new Map<string, string>();

  constructor(name: string, docUrl: string, websocketEndpoint: string, restfulEndpoint: string) {
    this.name = name;
    this.docUrl = docUrl;
    this.websocketEndpoint = websocketEndpoint;
    this.restfulEndpoint = restfulEndpoint;
  }

  public async init(): Promise<void> {
    const rawPairsInfo = await this.getRawPairsInfo();

    rawPairsInfo.forEach(rawPairInfo => {
      const pair = this.extractStandardPair(rawPairInfo);
      const rawPair = this.extractRawPair(rawPairInfo);
      this.pairMap.set(pair, rawPairInfo);
      this.standardToRawPair.set(pair, rawPair);
      this.rawToStandardPair.set(rawPair, pair);
    });
  }

  public getPairs(): Array<string> {
    return Array.from(this.standardToRawPair.keys());
  }

  public convertToStandardPair(rawPair: string): string {
    return this.rawToStandardPair.get(rawPair)!;
  }

  public abstract getChannel(crawlType: CrawlType, pair: string): string;

  protected abstract async getRawPairsInfo(): Promise<RawPairInfo[]>;

  protected abstract extractStandardPair(rawPairInfo: RawPairInfo): string;

  protected extractRawPair(rawPairInfo: RawPairInfo): string {
    return rawPairInfo.symbol;
  }
}
