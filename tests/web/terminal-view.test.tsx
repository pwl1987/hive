// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { TerminalView } from '../../web/src/terminal/TerminalView.js'

let latestCustomKeyHandler: ((event: KeyboardEvent) => boolean) | undefined
let terminalWrites: string[] = []
let terminalBufferType: 'alternate' | 'normal' = 'normal'
let terminalMouseTrackingMode: 'any' | 'drag' | 'none' | 'vt200' | 'x10' = 'none'
let terminalApplicationCursorKeysMode = false

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly OPEN = 1
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  sent: string[] = []

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = this.OPEN
      this.onopen?.()
    })
  }

  close() {}
  send(payload: string) {
    this.sent.push(payload)
  }
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = []

  constructor(readonly callback: () => void) {
    MockResizeObserver.instances.push(this)
  }

  disconnect() {}
  observe() {}
  trigger() {
    this.callback()
  }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 132
    rows = 43
    unicode = { activeVersion: '' }
    get buffer() {
      return { active: { type: terminalBufferType } }
    }
    get modes() {
      return {
        applicationCursorKeysMode: terminalApplicationCursorKeysMode,
        mouseTrackingMode: terminalMouseTrackingMode,
      }
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      latestCustomKeyHandler = handler
    }
    loadAddon() {}
    onData() {
      return { dispose() {} }
    }
    open() {}
    write(chunk?: string, callback?: () => void) {
      if (chunk !== undefined) terminalWrites.push(chunk)
      callback?.()
    }
    dispose() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}))

afterEach(() => {
  cleanup()
  MockWebSocket.instances = []
  MockResizeObserver.instances = []
  latestCustomKeyHandler = undefined
  terminalWrites = []
  terminalApplicationCursorKeysMode = false
  terminalBufferType = 'normal'
  terminalMouseTrackingMode = 'none'
  vi.unstubAllGlobals()
})

const addPortalSlot = (runId: string) => {
  const slot = document.createElement('div')
  slot.id = `orch-pty-${runId}`
  document.body.appendChild(slot)
  return slot
}

describe('TerminalView', () => {
  test('opens io and control sockets for the provided run id', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-123')

    render(<TerminalView runId="run-123" title="Alice" />)

    await waitFor(() => {
      const urls = MockWebSocket.instances.map((socket) => new URL(socket.url))
      expect(urls.map((url) => url.pathname)).toEqual([
        '/ws/terminal/run-123/io',
        '/ws/terminal/run-123/control',
      ])
      expect(urls[0]?.searchParams.get('clientId')).toBeTruthy()
      expect(urls[1]?.searchParams.get('clientId')).toBe(urls[0]?.searchParams.get('clientId'))
      expect(urls[0]?.searchParams.get('cols')).toBe('132')
      expect(urls[0]?.searchParams.get('rows')).toBe('43')
    })
  })

  test('sends the initial fit resize after the control socket opens', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-resize')

    render(<TerminalView runId="run-resize" title="Alice" />)

    await waitFor(() => {
      const controlSocket = MockWebSocket.instances[1]
      expect(controlSocket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({
        type: 'resize',
        cols: 132,
        rows: 43,
      })
    })
  })

  test('resizes again when the terminal container changes size', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    vi.stubGlobal('ResizeObserver', MockResizeObserver as never)
    addPortalSlot('run-observer')

    render(<TerminalView runId="run-observer" title="Alice" />)

    await waitFor(() => {
      expect(MockWebSocket.instances[1]?.sent).toHaveLength(1)
    })

    MockResizeObserver.instances[0]?.trigger()

    await waitFor(() => {
      expect(MockWebSocket.instances[1]?.sent).toHaveLength(2)
    })
  })

  test('does not render an inline terminal before a portal slot exists', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)

    render(<TerminalView runId="run-detached" title="Alice" />)

    expect(document.querySelector('[data-testid="terminal-run-detached"]')).toBeNull()
    expect(document.querySelector('section[aria-label="Terminal Alice"]')).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(0)

    const slot = addPortalSlot('run-detached')

    await waitFor(() => {
      expect(slot.querySelector('[data-testid="terminal-run-detached"]')).not.toBeNull()
      expect(MockWebSocket.instances).toHaveLength(2)
    })
    expect(MockWebSocket.instances.map((socket) => new URL(socket.url).pathname)).toEqual([
      '/ws/terminal/run-detached/io',
      '/ws/terminal/run-detached/control',
    ])
  })

  test('buffers live output until the restore snapshot is written', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-restore-order')

    render(<TerminalView runId="run-restore-order" title="Alice" />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2)
    })
    const [ioSocket, controlSocket] = MockWebSocket.instances
    ioSocket?.onmessage?.({ data: 'live-after-attach' })

    expect(terminalWrites).toEqual([])

    controlSocket?.onmessage?.({
      data: JSON.stringify({ type: 'restore', snapshot: 'restored-history' }),
    })

    expect(terminalWrites).toEqual(['restored-history', 'live-after-attach'])
    expect(controlSocket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'restore_complete',
    })
    expect(controlSocket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'output_ack',
      bytes: new TextEncoder().encode('live-after-attach').byteLength,
    })
  })

  test('maps Shift+Enter to a modified Enter sequence instead of submit Enter', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-shift-enter')

    render(<TerminalView runId="run-shift-enter" title="Alice" />)

    await waitFor(() => {
      expect(latestCustomKeyHandler).toBeDefined()
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
    })

    const keydownHandled = latestCustomKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })
    )
    const keypressHandled = latestCustomKeyHandler?.(
      new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, shiftKey: true })
    )

    expect(keydownHandled).toBe(false)
    expect(keypressHandled).toBe(false)
    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u001b[13;2u'])
  })

  test('falls back to arrow-key wheel input for alternate-screen TUIs without mouse tracking', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'alternate'
    addPortalSlot('run-wheel-alt')

    render(<TerminalView runId="run-wheel-alt" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-alt"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    fireEvent.wheel(terminal, { deltaY: 120 })
    fireEvent.wheel(terminal, { deltaY: -120 })

    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u001b[B', '\u001b[A'])
  })

  test('maps OpenCode wheel input to the message viewport scroll keys', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'alternate'
    addPortalSlot('run-wheel-opencode')

    render(<TerminalView inputProfile="opencode" runId="run-wheel-opencode" title="OpenCode" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-opencode"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    fireEvent.wheel(terminal, { deltaY: 120 })
    fireEvent.wheel(terminal, { deltaY: -120 })

    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u0004', '\u0015'])
  })

  test('uses application cursor arrow sequences for alternate-screen wheel fallback', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalApplicationCursorKeysMode = true
    terminalBufferType = 'alternate'
    addPortalSlot('run-wheel-app-cursor')

    render(<TerminalView runId="run-wheel-app-cursor" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-app-cursor"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    fireEvent.wheel(terminal, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: 1 })
    fireEvent.wheel(terminal, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: -1 })

    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u001bOB', '\u001bOA'])
  })

  test('does not amplify small trackpad wheel deltas into one input per event', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'alternate'
    addPortalSlot('run-wheel-trackpad')

    render(<TerminalView runId="run-wheel-trackpad" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-trackpad"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    for (let index = 0; index < 5; index++) {
      fireEvent.wheel(terminal, { deltaMode: WheelEvent.DOM_DELTA_PIXEL, deltaY: 10 })
    }
    expect(MockWebSocket.instances[0]?.sent).toEqual([])

    fireEvent.wheel(terminal, { deltaMode: WheelEvent.DOM_DELTA_PIXEL, deltaY: 10 })

    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u001b[B'])
  })

  test('consumes alternate-screen fallback wheel events before page scroll handlers run', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'alternate'
    addPortalSlot('run-wheel-consume')

    render(<TerminalView runId="run-wheel-consume" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-consume"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })
    let bubbled = false
    terminal.parentElement?.addEventListener('wheel', () => {
      bubbled = true
    })

    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    terminal.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(bubbled).toBe(false)
    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u001b[B'])
  })

  test('consumes small alternate-screen trackpad wheel deltas even before emitting input', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'alternate'
    addPortalSlot('run-wheel-small-consume')

    render(<TerminalView runId="run-wheel-small-consume" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-small-consume"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })
    let bubbled = false
    terminal.parentElement?.addEventListener('wheel', () => {
      bubbled = true
    })

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: 10,
    })
    terminal.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(bubbled).toBe(false)
    expect(MockWebSocket.instances[0]?.sent).toEqual([])
  })

  test('keeps normal scrollback wheel events out of PTY input', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'normal'
    addPortalSlot('run-wheel-normal')

    render(<TerminalView runId="run-wheel-normal" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-normal"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    fireEvent.wheel(terminal, { deltaY: 120 })

    expect(MockWebSocket.instances[0]?.sent).toEqual([])
  })

  test.each([
    'any',
    'drag',
    'vt200',
    'x10',
  ] as const)('does not duplicate xterm %s mouse tracking wheel events', async (mouseTrackingMode) => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    terminalBufferType = 'alternate'
    terminalMouseTrackingMode = mouseTrackingMode
    addPortalSlot('run-wheel-mouse')

    render(<TerminalView runId="run-wheel-mouse" title="Alice" />)

    const terminal = await waitFor(() => {
      const node = document.querySelector('[data-testid="terminal-run-wheel-mouse"]')
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
      expect(node).not.toBeNull()
      return node as HTMLElement
    })

    fireEvent.wheel(terminal, { deltaY: 120 })

    expect(MockWebSocket.instances[0]?.sent).toEqual([])
  })
})
