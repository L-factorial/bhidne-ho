import { ui } from '../i18n/copy.ts';
export type TableMessage = { type: 'TABLE_CHAT_MESSAGE'; id: string; room_id: string; match_id: string; sender_id: string; sender_player_id: number; sender_name: string; text: string; sent_at: number };
export type SocialAck = { type: 'TABLE_SOCIAL_ACK'; room_id: string; match_id: string; command_id: string; status: 'accepted' | 'rejected'; detail?: string; messages?: TableMessage[]; message?: TableMessage };
export class TableSocialChannel {
  send: (message: object) => boolean = () => false;
  private listeners = new Set<(event: unknown) => void>();
  subscribe(listener: (event: unknown) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  receive(event: unknown) { this.listeners.forEach(listener => listener(event)); }
  request(type: 'TABLE_CHAT_SEND' | 'TABLE_CHAT_HISTORY' | 'TABLE_POKE_SEND', match_id: string, payload: object, signal: AbortSignal): Promise<SocialAck> {
    const command_id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const command = { type, match_id, command_id, payload };
    return new Promise((resolve, reject) => {
      let attempts = 0;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: string, result?: SocialAck) => {
        clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', cancel);
        if (error) reject(new Error(error)); else resolve(result!);
      };
      const cancel = () => finish(ui("feedback.social_request_cancelled"));
      const unsubscribe = this.subscribe(value => {
        const event = value as SocialAck;
        if (event?.type === 'TABLE_SOCIAL_ACK' && event.match_id === match_id && event.command_id === command_id) {
          finish(event.status === 'accepted' ? undefined : event.detail || ui("feedback.social_action_rejected"), event);
        }
      });
      const attempt = () => {
        if (signal.aborted) { cancel(); return; }
        if (attempts++ >= 3) { finish(ui("common.could_not_confirm_delivery_check_the_conversation_before_sending_again")); return; }
        // Retry the same ID; the server deduplicates across reconnects/tabs.
        timer = setTimeout(attempt, 4000);
        this.send(command);
      };
      signal.addEventListener('abort', cancel, { once: true }); attempt();
    });
  }
}

export function mergeTableMessages(current: TableMessage[], incoming: TableMessage[]): TableMessage[] {
  const items = new Map(current.map(message => [message.id, message]));
  incoming.forEach(message => items.set(message.id, message));
  return [...items.values()].sort((a,b) => a.sent_at-b.sent_at).slice(-100);
}
