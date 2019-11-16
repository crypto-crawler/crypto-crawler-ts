/* eslint-disable camelcase */
import { BaseOrder } from 'coinbase-pro';

/**
 * Root class for all messages.
 */
export interface Msg {
  exchange: string;
  channel: string; // original websocket channel
  pair: string; // normalized pair name, upper case, splited by /, e.g., BTC/USDT
  createdAt: Date; // MongoDB
  raw: string; // the original message
  [key: string]: any; // parsed from raw
}

export interface TradeMsg extends Msg {
  _id?: number;
  price: number;
  size: number;
  side: string;
  timestamp: Date;
  trade_id?: number;
}

export interface OrderMsg extends Msg {
  price: number;
  quantity: number;
  cost: number;
}

export interface OrderBookMsg extends Msg {
  asks: Array<OrderMsg>;
  bids: Array<OrderMsg>;
}

// Specific data types for different exchanges
export interface NewdexOrderMsg extends Msg {}

export interface GdaxMsg extends Msg, BaseOrder {}
