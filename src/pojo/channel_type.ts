export const CHANNEL_TYPES = ['BBO', 'KLine', 'OrderBook', 'Ticker', 'Trade'] as const;

export type ChannelType = typeof CHANNEL_TYPES[number];
