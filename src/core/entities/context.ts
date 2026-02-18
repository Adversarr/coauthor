export interface ContextData {
  env: {
    workingDirectory: string
    platform: string
    date: string
  }
  project: {
    agentsMd?: string
  }
}
