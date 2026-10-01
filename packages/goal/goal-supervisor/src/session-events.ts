/** Durable, log-only events for the goal supervisor's auxiliary model calls. */

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Records the complete prompt and options sent to the supervisor LLM. */
    'goal-supervisor/llm-request': {
      kind: 'evaluation' | 'consolidation'
      provider: string
      model: string
      system: string
      userText: string
      temperature: 0
      maxTokens: number
    }
    /** Records the raw response or failure for one logged supervisor request. */
    'goal-supervisor/llm-result': {
      requestSeq: number
      status: 'complete' | 'failed'
      response?: string
    }
  }
}

export {}
