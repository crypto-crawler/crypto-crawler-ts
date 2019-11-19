export default function convertToStandardPair(rawPair: string, quoteCurrencies: string[]): string {
  for (let i = 0; i < quoteCurrencies.length; i += 1) {
    const quoteCurrency = quoteCurrencies[i];
    if (rawPair.endsWith(quoteCurrency)) {
      return `${rawPair.substring(0, rawPair.length - quoteCurrency.length)}_${quoteCurrency}`;
    }
  }
  throw Error(`Unknown rawPair: ${rawPair}`);
}
