import type { AppError } from '../contracts'

export class YouTraceError extends Error {
  readonly code: string
  readonly details: Record<string, unknown> | undefined
  readonly recovery: string | undefined

  constructor(error: AppError) {
    super(error.message)
    this.name = 'YouTraceError'
    this.code = error.code
    this.details = error.details
    this.recovery = error.recovery
  }

  toJSON(): AppError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.recovery ? { recovery: this.recovery } : {})
    }
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof YouTraceError) {
    return error.toJSON()
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED_ERROR',
      message: '发生了未预期的问题，当前操作没有完成。',
      details: { name: error.name }
    }
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: '发生了未预期的问题，当前操作没有完成。'
  }
}
