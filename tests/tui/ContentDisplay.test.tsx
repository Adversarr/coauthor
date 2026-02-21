import React from 'react'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { ContentDisplay } from '../../src/interfaces/tui/components/interaction/ContentDisplay.js'
import type { InteractionDisplay } from '../../src/core/events/events.js'

describe('ContentDisplay', () => {
  it('renders diff payloads through DiffView', () => {
    const display: InteractionDisplay = {
      title: 'Confirm edit',
      contentKind: 'Diff',
      content: '--- a\n+++ b\n-old\n+new',
    }

    const { lastFrame } = render(<ContentDisplay display={display} />)
    expect(lastFrame()).toContain('--- a')
    expect(lastFrame()).toContain('+new')
    expect(lastFrame()).toContain('-old')
  })

  it('renders plain string content directly', () => {
    const display: InteractionDisplay = {
      title: 'Info',
      contentKind: 'PlainText',
      content: 'hello world',
    }

    const { lastFrame } = render(<ContentDisplay display={display} />)
    expect(lastFrame()).toContain('hello world')
  })

  it('renders object content as pretty JSON', () => {
    const display: InteractionDisplay = {
      title: 'Json',
      contentKind: 'Json',
      content: { foo: 'bar', count: 2 },
    }

    const { lastFrame } = render(<ContentDisplay display={display} />)
    expect(lastFrame()).toContain('"foo": "bar"')
    expect(lastFrame()).toContain('"count": 2')
  })
})
