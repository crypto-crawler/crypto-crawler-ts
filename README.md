# crypto-crawler

Crawl orderbook and trade messages from crypto exchanges.

## How to use

```javascript
const CryptoCrawler = require('crypto-crawler');

function processMsgCallback(msg) {
  console.dir(msg);
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
npx crypto-crawler --exchange newdex
```

## Help

```bash
npx crypto-crawler --help
```
