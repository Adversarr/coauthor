export type TelemetryEvent =
  | {
      type: 'tool_result_persisted'
      payload: { taskId: string; toolCallId: string; toolName: string; isError: boolean }
    }
  | {
      type: 'conversation_repair_applied'
      payload: { taskId: string; repairedToolResults: number; retriedToolCalls: number }
    }

export interface TelemetrySink {
  emit(event: TelemetryEvent): void
}

export class NoopTelemetrySink implements TelemetrySink {
  emit(_event: TelemetryEvent): void {}
}

export class ConsoleTelemetrySink implements TelemetrySink {
  emit(event: TelemetryEvent): void {
    console.log(JSON.stringify({ ts: Date.now(), ...event }))
  }
}

