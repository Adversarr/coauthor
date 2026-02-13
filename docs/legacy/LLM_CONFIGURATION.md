# LLM Configuration Guide

## Overview

CoAuthor supports multiple LLM providers and allows you to customize which models to use for different tasks.

## Environment Variables

Configure your LLM settings in the `.env` file at the root of your project:

```bash
# LLM Provider: 'fake' for testing, 'openai' for production
COAUTHOR_LLM_PROVIDER=openai

# OpenAI API Key (required when provider is 'openai')
COAUTHOR_OPENAI_API_KEY=sk-your-key-here

# Optional: Custom OpenAI base URL (for proxies, Azure OpenAI, or compatible APIs)
COAUTHOR_OPENAI_BASE_URL=https://api.openai.com/v1

# Optional: Model selection by profile
COAUTHOR_OPENAI_MODEL_FAST=gpt-4o-mini
COAUTHOR_OPENAI_MODEL_WRITER=gpt-4o
COAUTHOR_OPENAI_MODEL_REASONING=gpt-4o
```

## Custom Models

### Using OpenAI-Compatible APIs

If you're using an OpenAI-compatible API (like Azure OpenAI, LocalAI, LM Studio, etc.), you can configure it by setting:

```bash
COAUTHOR_LLM_PROVIDER=openai
COAUTHOR_OPENAI_API_KEY=your-api-key
COAUTHOR_OPENAI_BASE_URL=https://your-api-endpoint.com/v1
```

### Custom Model Names

You can specify custom model names for different task profiles:

- **fast**: Used for quick operations and real-time interactions
- **writer**: Used for content generation and editing tasks
- **reasoning**: Used for complex reasoning and planning tasks

Example:
```bash
COAUTHOR_OPENAI_MODEL_FAST=gpt-3.5-turbo
COAUTHOR_OPENAI_MODEL_WRITER=gpt-4-turbo
COAUTHOR_OPENAI_MODEL_REASONING=o1-preview
```

### Azure OpenAI Example

```bash
COAUTHOR_LLM_PROVIDER=openai
COAUTHOR_OPENAI_API_KEY=your-azure-key
COAUTHOR_OPENAI_BASE_URL=https://your-resource.openai.azure.com/openai/deployments
COAUTHOR_OPENAI_MODEL_FAST=gpt-35-turbo
COAUTHOR_OPENAI_MODEL_WRITER=gpt-4
COAUTHOR_OPENAI_MODEL_REASONING=gpt-4
```

### Local LLM Example (LM Studio)

```bash
COAUTHOR_LLM_PROVIDER=openai
COAUTHOR_OPENAI_API_KEY=not-needed
COAUTHOR_OPENAI_BASE_URL=http://localhost:1234/v1
COAUTHOR_OPENAI_MODEL_FAST=local-model
COAUTHOR_OPENAI_MODEL_WRITER=local-model
COAUTHOR_OPENAI_MODEL_REASONING=local-model
```

## Testing Connection

Use the CLI command to test your LLM configuration:

```bash
# Test with complete mode (default)
coauthor llm test

# Test with streaming mode
coauthor llm test --mode stream

# Test with fake provider (no API key needed)
COAUTHOR_LLM_PROVIDER=fake coauthor llm test
```

The test command will:
- Verify your API credentials
- Check network connectivity
- Measure response time
- Display a sample response

### Expected Output

Success:
```
Testing LLM client connection (mode: complete)...
✓ Connection successful (245ms)
  Response: OK
  Stop reason: end_turn
```

Failure:
```
Testing LLM client connection (mode: complete)...
✗ Connection failed
  Error: Missing COAUTHOR_OPENAI_API_KEY
```

## Troubleshooting

### Connection Timeout

If you see "Connect Timeout Error":
- Check your internet connection
- Verify the API endpoint URL is correct
- Try using a proxy if you're behind a firewall
- Check if the API service is operational

### Missing API Key

If you see "Missing COAUTHOR_OPENAI_API_KEY":
- Make sure you have a `.env` file in the project root
- Verify the API key is properly set in `.env`
- The API key should start with `sk-` for OpenAI

### Unsupported Model

If you see "Unsupported model version":
- Update to the latest AI SDK: `npm install ai@latest @ai-sdk/openai@latest`
- Check if the model name is correct
- For custom models, ensure they're compatible with OpenAI's API format

### Authentication Failed

If you see authentication errors:
- Verify your API key is valid
- Check if your API key has the necessary permissions
- For Azure OpenAI, ensure the key and endpoint are correctly configured

## Fake Provider (Testing)

For development and testing without using real API calls:

```bash
COAUTHOR_LLM_PROVIDER=fake
```

The fake provider returns mock responses and doesn't require any API key or network connection.
