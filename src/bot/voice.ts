/**
 * Voice Transcription
 *
 * Handles transcription of voice messages using Google Gemini.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { TelegramBot } from "./telegram.js";
import type { TelegramVoice } from "../storage/types.js";

/**
 * Transcribe a voice message using Gemini
 */
export async function transcribeVoice(voice: TelegramVoice, bot: TelegramBot): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  // Download the voice file from Telegram
  const { fileUrl } = await bot.getFile(voice.file_id);
  const audioData = await bot.downloadFile(fileUrl);

  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  // Convert audio to base64
  const base64Audio = Buffer.from(audioData).toString("base64");

  // Determine MIME type
  const mimeType = voice.mime_type || "audio/ogg";

  // Send to Gemini for transcription
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Audio,
      },
    },
    {
      text: `Transcribe this voice message accurately. The speaker is likely logging a workout or talking about fitness.

Common patterns to listen for:
- Exercise names (bench, squat, deadlift, OHP, pull-ups, etc.)
- Weight and rep patterns like "175 for 5" or "three sets of eight"
- RPE mentions like "RPE 8" or "that was an 8"
- General workout commentary

Return ONLY the transcription, no additional commentary.`,
    },
  ]);

  const response = result.response;
  const transcription = response.text().trim();

  if (!transcription) {
    throw new Error("Failed to transcribe voice message");
  }

  return transcription;
}

/**
 * Check if voice transcription is available
 */
export function isVoiceTranscriptionAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
