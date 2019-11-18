/* eslint-disable camelcase */
import CrawlType from '../crawler/crawl_type';

// Ground truth of an exchange
export default abstract class ExchangeMetaInfo {
  name: string;

  docUrl: string;

  websocketEndpoint: string;

  restfulEndpoint: string;

  constructor(name: string, docUrl: string, websocketEndpoint: string, restfulEndpoint: string) {
    this.name = name;
    this.docUrl = docUrl;
    this.websocketEndpoint = websocketEndpoint;
    this.restfulEndpoint = restfulEndpoint;
  }

  public abstract getRawPairs(): Promise<Array<string>>;

  public abstract getChannel(crawlType: CrawlType, pair: string): string;

  public abstract convertToStandardPair(channel: string): string;

  public abstract convertToRawPair(pair: string): string;
}
