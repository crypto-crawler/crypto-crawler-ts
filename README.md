# crypto-crawler

Crypto Crawler

## How to use

```javascript
const cryptoCrawler = require('crypto-crawler');

function processMsgCallback(msg) {
  console.dir(msg);
}

const crawler = new cryptoCrawler.NewdexCrawler(
  [cryptoCrawler.CrawlType.ORDER_BOOK],
  ['EIDOS_EOS'],
  processMsgCallback,
);

crawler.start();
```

Test only,

```bash
npx crypto-crawler --exchange newdex
```
