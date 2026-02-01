# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in IronClaude, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include a detailed description of the vulnerability
4. Provide steps to reproduce if possible

## Response Timeline

- We aim to acknowledge reports within 48 hours
- We will provide updates on the fix timeline within 7 days
- Critical vulnerabilities will be prioritized

## Security Considerations

### API Keys and Secrets

IronClaude requires several API keys to function:

- **Anthropic API Key**: Used for Claude AI interactions
- **Telegram Bot Token**: Used for bot communication
- **GitHub Token**: Used for data storage
- **Gemini API Key**: Optional, for voice transcription

**Important:**
- Never commit `.env` files or API keys to version control
- Use environment variables for all secrets
- Rotate keys if you suspect they've been compromised

### Data Privacy

- All user fitness data is stored in a private GitHub repository that you control
- The bot only responds to your authorized Telegram chat ID
- Voice messages are processed through Google's Gemini API if voice transcription is enabled

### Deployment Security

- Enable the `TELEGRAM_WEBHOOK_SECRET` for webhook verification
- Set a strong `CRON_SECRET` to protect cron endpoints
- Deploy behind HTTPS (Fly.io handles this automatically)

## Supported Versions

We provide security updates for the latest release only. Please keep your installation up to date.
