export const CHANNEL_TYPES = [
  'BBO',
  'FullOrderBook',
  'KLine',
  'OrderBook', // first is full, followed by updates
  'OrderBookUpdate',
  'Ticker',
  'Trade',
] as const;

export type ChannelType = typeof CHANNEL_TYPES[number];
