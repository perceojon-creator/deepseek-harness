/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * A stdio child's stderr is piped (so server chatter never paints over the
 * terminal UI) and drained line by line into `onStderrLine`; a piped stream
 * that nothing reads would fill the OS pipe buffer and stall the child.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param onStderrLine - Receives each stderr line of a stdio child.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config, onStderrLine: (line: string) => void): Transport {
  switch (config.transport) {
    case 'stdio': {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
        stderr: 'pipe',
      })
      // With `stderr: 'pipe'` the SDK returns its PassThrough (typed as the wider `Stream`) before spawn.
      createInterface({ input: transport.stderr as Readable, crlfDelay: Infinity }).on('line', onStderrLine)
      return transport
    }
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      ) as Transport
  }
}
