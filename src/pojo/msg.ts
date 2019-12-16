import { BaseOrder } from 'coinbase-pro';

/**
 * Root class for all messages.
 */
export interface Msg {
  exchange: string;
  channel: string; // original websocket channel
  pair: string; // normalized pair name, upper case, splited by /, e.g., BTC/USDT
  timestamp: number; // Unix timestamp, in milliseconds
  raw: string; // the original message
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

// Specific data types for different exchanges
export interface NewdexOrderMsg extends Msg {}

export interface GdaxMsg extends Msg, BaseOrder {}
