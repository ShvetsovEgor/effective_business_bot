export type Button = { text: string; action: string } | { text: string; url: string };
export interface Screen { text: string; buttons: Button[]; documentId?: string }
export type Event = { type: 'command'; command: string } | { type: 'text'; text: string } | { type: 'callback'; payload: string };
