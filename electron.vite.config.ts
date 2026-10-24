import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

// Paths are resolved against the project root (process.cwd()), like the official
// electron-vite templates.
// NOTE: if this project lives under a packaged app's virtualized AppData\Roaming
// (e.g. a Claude scratch workspace), Vite's realpath() of the root points into
// Local\Packages\...\LocalCache and the renderer build fails except from Git Bash.
// Keep the project in a normal folder such as D:\backseat.
const root = process.cwd()

/**
 * @fontsource CSS lists every face as woff2 plus a woff fallback. Chromium always takes the woff2, so
 * the woff copies only made the installer bigger (≈10 MB for the Korean fonts, ≈20 MB more with the
 * Japanese / Chinese ones): drop them before Vite resolves the url()s.
 */
function woff2Only(): Plugin {
  return {
    name: 'backseat-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/@fontsource[\\/].+\.css(\?|$)/.test(id)) return null
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, ''), map: null }
    }
  }
}

export default defineConfig({
  main: {
    // koffi is a native (N-API) module: it must stay external, loaded from node_modules at runtime.
    // The MCP SDK and zod are bundled instead: the installed app runs out/main/mcp-server.js with plain
    // Node from app.asar.unpacked, where there is no node_modules to resolve them from.
    plugins: [externalizeDepsPlugin({ exclude: ['@modelcontextprotocol/sdk', 'zod'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts'),
          // worker_threads entry for speech recognition (out/main/stt-worker.js)
          'stt-worker': resolve(root, 'src/main/stt/worker.ts'),
          // worker_threads entry for UI Automation focus checks before a paste (out/main/uia-worker.js)
          'uia-worker': resolve(root, 'src/main/native/uia-worker.ts'),
          // stdio MCP server run by plain Node (out/main/mcp-server.js); never imports electron
          'mcp-server': resolve(root, 'src/main/mcp/server.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [woff2Only()],
    build: {
      rollupOptions: {
        input: {
          selector: resolve(root, 'src/renderer/selector/index.html'),
          editor: resolve(root, 'src/renderer/editor/index.html'),
          about: resolve(root, 'src/renderer/about/index.html')
        }
      }
    }
  }
})
