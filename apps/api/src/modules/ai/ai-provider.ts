import type { AppConfig } from '../../config/config';

/**
 * The AI model behind question answering. Only the API server talks to it; the browser never
 * sees the provider, the key or the prompt.
 */
export interface AiCompletion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  /** "anthropic", "offline" or "disabled" (tests may use their own). */
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  complete(request: { system: string; user: string; maxTokens: number }): Promise<AiCompletion>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** The provider could not give an answer. The message is safe to log (no prompt, no key). */
export class AiUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`AI provider unavailable: ${reason}`);
    this.name = 'AiUnavailableError';
  }
}

export class DisabledProvider implements AiProvider {
  readonly name = 'disabled';
  readonly model = 'none';
  readonly available = false;
  complete(): Promise<AiCompletion> {
    return Promise.reject(new AiUnavailableError('disabled'));
  }
}

/**
 * Anthropic Messages API, called with plain HTTPS. No tools, no browsing, temperature 0.
 * The key is sent only in the x-api-key header to Anthropic.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly available = true;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: { system: string; user: string; maxTokens: number }): Promise<AiCompletion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          temperature: 0,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
      });
      if (!response.ok) {
        // Only the status code is kept: provider error bodies can echo parts of the request.
        throw new AiUnavailableError(`http_${response.status}`);
      }
      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
      return {
        text,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    } catch (error) {
      if (error instanceof AiUnavailableError) throw error;
      throw new AiUnavailableError(
        (error as { name?: string }).name === 'AbortError' ? 'timeout' : 'network',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * LOCAL DEVELOPMENT AND TESTS ONLY (refused in staging and production by the configuration).
 * There is no AI model: it answers with a quote from the first passage it was given, so the
 * whole flow (retrieval, citations, checks, screens) can be used without an AI account.
 */
export class OfflineProvider implements AiProvider {
  readonly name = 'offline';
  readonly model = 'offline-quote';
  readonly available = true;

  complete(request: { system: string; user: string; maxTokens: number }): Promise<AiCompletion> {
    // The first source that has its own text (part headings have none).
    const sources = [
      ...request.user.matchAll(
        /BEGIN SOURCE (S\d+) \[[^\]]*\] -+\nReference: (.*)\n(?:.*\n)*?Text: ([\s\S]*?)\n-{3,} END SOURCE \1/g,
      ),
    ].filter((source) => !source[3]!.startsWith('(no text'));
    const match = sources[0];
    const label = match?.[2] ?? 'the passage';
    if (!match) {
      return Promise.resolve({ text: JSON.stringify({ status: 'insufficient' }), inputTokens: 0, outputTokens: 0 });
    }
    const text = match[3]!.trim();
    const sentence = (/^[\s\S]{8,300}?[.;:](?=\s|$)/.exec(text)?.[0] ?? text.slice(0, 300)).trim();
    return Promise.resolve({
      text: JSON.stringify({
        status: 'answered',
        explanation: `Offline test mode: no AI model is connected, so this is not an explanation. The passage that best matches your question is ${label}. Please read its original text below.`,
        citations: [{ source: match[1], quote: sentence }],
      }),
      inputTokens: 0,
      outputTokens: 0,
    });
  }
}

export function createAiProvider(config: AppConfig): AiProvider {
  switch (config.AI_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider(config.ANTHROPIC_API_KEY!, config.AI_MODEL, config.AI_TIMEOUT_MS);
    case 'offline':
      return new OfflineProvider();
    default:
      return new DisabledProvider();
  }
}
