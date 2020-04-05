# crypto-crawler

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
 * @export
 * @param {SupportedExchange} exchange The crypto exchange name
 * @param {ChannelType[]} channelTypes types of channels you want to crawl
 * @param {string[]} [pairs=[]] pairs you want to crawl
 * @param {ProcessMessageCallback} [processMsgCallback=defaultProcessMessageCallback] the callback to process messages
 * @returns {Promise<void>}
 */
async function crawl(
  exchange: SupportedExchange,
  channelTypes: ChannelType[],
  pairs?: string[],
  processMsgCallback?: ProcessMessageCallback,
): Promise<void>;
```

## Related Projects

- [crypto-client](https://www.npmjs.com/package/crypto-client), An unified client for all cryptocurrency exchanges.
- [coin-bbo](https://www.npmjs.com/package/coin-bbo), a crawler to get realtime BBO messages from crypto exchanges.
