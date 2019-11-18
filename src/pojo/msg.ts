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
  [key: string]: any; // parsed from raw
}

// eslint-disable-next-line import/prefer-default-export
export enum AskBid {
  ASK = 'ASK',
  BID = 'BID',
}

export interface TradeMsg extends Msg {
  price: number;
  quantity: number;
  side: AskBid;
  trade_id: number;
}

export interface OrderMsg extends Msg {
  price: number;
  quantity: number;
  cost: number;
}

export interface OrderBookMsg extends Msg {
  asks: Array<OrderMsg>;
  bids: Array<OrderMsg>;
  full: boolean;
}

// Specific data types for different exchanges
export interface NewdexOrderMsg extends Msg {}

export interface GdaxMsg extends Msg, BaseOrder {}
