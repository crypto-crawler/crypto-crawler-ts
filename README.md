# crypto-crawler

Crawl orderbook and trade messages from crypto exchanges.

## How to use

```javascript
const CryptoCrawler = require('crypto-crawler'); // eslint-disable-line import/no-unresolved

function processMsgCallback(msg) {
  console.dir(msg); // eslint-disable-line no-console
}

const crawler = new CryptoCrawler.NewdexCrawler(
  [CryptoCrawler.CrawlType.ORDER_BOOK],
  ['EIDOS_EOS'],
  processMsgCallback,
);

crawler.start();
```

## Quickstart

```bash
npx crypto-crawler --exchange Newdex
```

## Help

```bash
npx crypto-crawler --help
```

## Related Projects

- [crypto-order](https://www.npmjs.com/package/crypto-order), a library to place and cancel orders at crypto exchanges.
