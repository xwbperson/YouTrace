/// <reference types="vite/client" />

import type { YouTraceApi } from '../../shared/contracts'

declare global {
  interface Window {
    youtrace: YouTraceApi
  }
}

export {}
