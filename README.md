# crypto-crawler

Crypto Crawler

## How to use

```javascript
const cryptoCrawler = require('crypto-crawler');

const crawler = new cryptoCrawler.NewdexCrawler(
  [cryptoCrawler.CrawlType.ORDER_BOOK],
  ['EIDOS_EOS'],
);

crawler.start();
```

Test only,

```bash
npx crypto-crawler --exchange newdex
```
