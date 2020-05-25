import { MarketType } from 'crypto-markets';
import { ChannelType } from './channel_type';

/**
 * Root class for all messages.
 */
export interface Msg {
  exchange: string;
  marketType: MarketType;
  pair: string; // unified pair, from Market.pair, e.g., BTC_USDT
  rawPair: string; // exchange specific pair, from Market.id
  channel: string; // original websocket channel
  channelType: ChannelType;
  timestamp: number; // Unix timestamp, in milliseconds
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: { [key: string]: any }; // the original message
}

// 24hr rolling window ticker
export interface TickerMsg extends Msg {
  last_price: number;
  last_quantity: number;
  best_bid_price: number;
  best_bid_quantity: number;
  best_ask_price: number;
  best_ask_quantity: number;
  open_price_24h: number;
  high_price_24h: number;
  low_price_24h: number;
  base_volume_24h: number;
  quote_volume_24h: number;
}

export interface TradeMsg extends Msg {
  price: number;
  quantity: number;
  side: boolean; // true, ask; false, bid
  trade_id: string;
}

export interface OrderItem {
  price: number;
  quantity: number;
  cost: number;
  timestamp?: number;
}

export interface OrderBookMsg extends Msg {
  asks: Array<OrderItem>; // sorted from smallest to largest
  bids: Array<OrderItem>; // sorted from largest to smallest
  full: boolean;
}

export interface BboMsg extends Msg {
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
}

export interface KlineMsg extends Msg {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base volume
  period: string; // m, minute; H, hour; D, day; W, week; M, month; Y, year
  quoteVolume?: number; // quote volume
}

export interface FundingRateMsg extends Msg {
  fundingRate: number;
  fundingTime: number;
}
