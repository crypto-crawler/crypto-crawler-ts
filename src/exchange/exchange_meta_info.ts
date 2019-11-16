import CrawlType from '../crawler/crawl_type';

export interface ExchangeMetaInfo {
  name: string;
  websocketEndpoint: string;
  restfulEndpoint: string;

  getRawPairs(): Promise<Array<string>>;
  getChannel(crawlType: CrawlType, pair: string): string;
  convertToStandardPair(channel: string): string;
  convertToRawPair(pair: string): string;
}

export default abstract class ExchangeMetaInfoBase implements ExchangeMetaInfo {
  name: string;

  websocketEndpoint: string;

  restfulEndpoint: string;

  constructor(name: string, websocketEndpoint: string, restfulEndpoint: string) {
    this.name = name;
    this.websocketEndpoint = websocketEndpoint;
    this.restfulEndpoint = restfulEndpoint;
  }

  public abstract getRawPairs(): Promise<Array<string>>;

  public abstract getChannel(crawlType: CrawlType, pair: string): string;

  public abstract convertToStandardPair(channel: string): string;

  public abstract convertToRawPair(pair: string): string;
}
