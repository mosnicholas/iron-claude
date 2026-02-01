# Contributing to IronClaude

Thank you for your interest in contributing to IronClaude! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/iron-claude.git`
3. Install dependencies: `npm install`
4. Create a `.env` file based on `.env.example`
5. Run in development mode: `npm run dev`

## Development Workflow

### Code Style

- We use TypeScript for all source files
- Run `npm run lint:fix` before committing to auto-format code
- Run `npm run typecheck` to verify TypeScript types
- Keep functions small and focused
- Use descriptive variable names

### Testing

Run tests with:
```bash
npm test
```

Add tests for new functionality when possible.

### Checking for Unused Code

Periodically run:
```bash
npx knip
```

This helps identify unused exports, dependencies, and files.

## Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run linting and tests: `npm run lint:fix && npm test`
4. Commit with a clear message describing the change
5. Push to your fork and open a Pull Request

### Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Keep the first line under 72 characters
- Reference issues when relevant

## Pull Request Guidelines

- Provide a clear description of the changes
- Include any relevant issue numbers
- Ensure all checks pass
- Keep PRs focused - one feature or fix per PR

## Project Structure

```
iron-claude/
├── src/
│   ├── bot/          # Telegram bot integration
│   ├── coach/        # AI coaching agent (Claude Agent SDK)
│   ├── cron/         # Scheduled tasks
│   ├── handlers/     # HTTP request handlers
│   ├── storage/      # GitHub data storage
│   └── utils/        # Utility functions
├── scripts/          # Setup and deployment scripts
├── prompts/          # AI coaching prompts
└── templates/        # Document templates
```

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (Node version, OS, etc.)

## Questions?

Feel free to open an issue for questions about the codebase or contributing process.
