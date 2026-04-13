import type { IncomingChannelMessage } from '@claude-hub/core';

export type { IncomingChannelMessage } from '@claude-hub/core';
export type ChannelMessageHandler = (msg: IncomingChannelMessage) => void;

/**
 * Common interface that every channel adapter implements. The orchestrator
 * registers a single onMessage handler per channel.
 */
export interface ChannelAdapter {
  readonly id: string;
  readonly type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Send a text reply to the conversation that produced `conversationId`. */
  send(conversationId: string, text: string): Promise<void>;
  onMessage(handler: ChannelMessageHandler): void;
  /** Lightweight status for the UI. Does not include secrets. */
  status(): 'connected' | 'disconnected' | 'error';
  lastError(): string | undefined;
}
