# crypto-crawler

Crawl orderbook and trade messages from crypto exchanges.

## How to use

```javascript
const crawl = require('crypto-crawler').default; // eslint-disable-line import/no-unresolved

function processMsgCallback(msg) {
  console.dir(msg); // eslint-disable-line no-console
}

(async () => {
  await crawl('Newdex', ['OrderBook'], ['EIDOS_EOS'], processMsgCallback);
})();
```

## Quickstart

```bash
npx crypto-crawler --exchange Newdex
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

- [crypto-order](https://www.npmjs.com/package/crypto-order), a library to place and cancel orders at crypto exchanges.
