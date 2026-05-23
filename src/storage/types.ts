/**
 * Telegram payload types. The rest of the pre-migration markdown shapes
 * (Profile, WorkoutLog, PRsData, etc.) lived here and have been removed —
 * structured data now flows through `src/db/schema.ts` types instead.
 */

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  photo?: TelegramPhotoSize[];
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}
