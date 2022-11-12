# crypto-crawler

**This project is deprecated in favor of [crypto-crawler-rs](https://github.com/crypto-crawler/crypto-crawler-rs)**

Crawl orderbook and trade messages from crypto exchanges.

## How to use

```javascript
/* eslint-disable */
const crawl = require('crypto-crawler').default;

function processMsgCallback(msg) {
  console.dir(msg);
}

(async () => {
  await crawl('CoinbasePro', 'Spot', ['OrderBook'], ['BTC_USD'], processMsgCallback);
})();
```

## Quickstart

```bash
npx crypto-crawler --exchange CoinbasePro --marketType Spot --channelType OrderBook --pairs BTC_USD
```

## Help

```bash
npx crypto-crawler --help
```

## API Manual

There is only one API in this library:

```typescript
/**
 * Crawl messages from a crypto exchange.
 *
 * @param exchange The crypto exchange name
 * @param marketType Market type, e.g., Spot, Futures
 * @param channelTypes Channel types to crawl, e.g., Trade, BBO, OrderBook
 * @param pairs Trading pairs, e.g., BTC_USDT
 * @param msgCallback The callback function to process messages
 * @returns void
 */
export default function crawl(
  exchange: string,
  marketType: MarketType,
  channelTypes: readonly ChannelType[],
  pairs: readonly string[],
  msgCallback?: MsgCallback,
): Promise<void>;
```

## Related Projects

- [crypto-client](https://www.npmjs.com/package/crypto-client), An unified client for all cryptocurrency exchanges.
- [coin-bbo](https://www.npmjs.com/package/coin-bbo), a crawler to get realtime BBO messages from crypto exchanges.
