import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Paths are resolved against the project root (process.cwd()), like the official
// electron-vite templates.
// NOTE: if this project lives under a packaged app's virtualized AppData\Roaming
// (e.g. a Claude scratch workspace), Vite's realpath() of the root points into
// Local\Packages\...\LocalCache and the renderer build fails except from Git Bash.
// Keep the project in a normal folder such as D:\backseat.
const root = process.cwd()

export default defineConfig({
  main: {
    // koffi is a native (N-API) module: it must stay external, loaded from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts'),
          // worker_threads entry for speech recognition (out/main/stt-worker.js)
          'stt-worker': resolve(root, 'src/main/stt/worker.ts'),
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
    build: {
      rollupOptions: {
        input: {
          selector: resolve(root, 'src/renderer/selector/index.html'),
          editor: resolve(root, 'src/renderer/editor/index.html')
        }
      }
    }
  }
})
