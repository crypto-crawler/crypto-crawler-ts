export const CHANNEL_TYPES = [
  'BBO',
  'Kline',
  'OrderBook',
  'Ticker',
  'Trade',
  'FundingRate',
] as const;

export type ChannelType = typeof CHANNEL_TYPES[number];
