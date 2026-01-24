import type {
  SendMessageParams,
  TelegramApiResponse,
  TelegramReplyMarkup,
} from '../types/index.js';

export class TelegramService {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(params: SendMessageParams): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = (await response.json()) as TelegramApiResponse;

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }
  }

  async sendMessageWithKeyboard(
    chatId: number,
    text: string,
    buttons: string[][],
    oneTime = true
  ): Promise<void> {
    const replyMarkup: TelegramReplyMarkup = {
      keyboard: buttons.map((row) => row.map((text) => ({ text }))),
      one_time_keyboard: oneTime,
      resize_keyboard: true,
    };

    await this.sendMessage({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  }

  async sendMessageWithInlineKeyboard(
    chatId: number,
    text: string,
    buttons: Array<{ text: string; data: string }[]>
  ): Promise<void> {
    const replyMarkup: TelegramReplyMarkup = {
      inline_keyboard: buttons.map((row) =>
        row.map((btn) => ({ text: btn.text, callback_data: btn.data }))
      ),
    };

    await this.sendMessage({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  }

  async removeKeyboard(chatId: number, text: string): Promise<void> {
    await this.sendMessage({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true },
    });
  }

  async setWebhook(url: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = (await response.json()) as TelegramApiResponse;

    if (!data.ok) {
      throw new Error(`Failed to set webhook: ${data.description}`);
    }
  }

  async deleteWebhook(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/deleteWebhook`, {
      method: 'POST',
    });

    const data = (await response.json()) as TelegramApiResponse;

    if (!data.ok) {
      throw new Error(`Failed to delete webhook: ${data.description}`);
    }
  }
}
