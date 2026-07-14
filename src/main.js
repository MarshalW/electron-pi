const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

let mainWindow = null
let piSession = null

function getConfigPath() {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'config.json')
  }
  const dir = path.join(os.homedir(), '.electron-proto')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'config.json')
}

function loadConfig() {
  const p = getConfigPath()
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function saveConfig(data) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf-8')
}

function expandHome(dir) {
  if (!dir) return dir
  if (dir.startsWith('~')) return path.join(os.homedir(), dir.slice(1))
  return dir
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700, height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
}

ipcMain.handle('config:get', () => loadConfig())

ipcMain.handle('config:save', (_event, config) => {
  saveConfig(config)
  return true
})

ipcMain.handle('session:create', async (_event, config) => {
  try {
    const {
      createAgentSession, SessionManager, DefaultResourceLoader,
      AuthStorage, InMemoryAuthStorageBackend, getAgentDir,
      ModelRegistry,
    } = await import('@earendil-works/pi-coding-agent')

    // 1. Auth: set runtime API key so PI SDK can authenticate with DeepSeek
    process.env.DEEPSEEK_API_KEY = config.apiKey
    const authStorage = new AuthStorage(new InMemoryAuthStorageBackend())
    await authStorage.reload()
    authStorage.setRuntimeApiKey(config.provider, config.apiKey)

    // 2. Resolve full model definition from registry
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    const model = modelRegistry.find(config.provider, config.model)
    if (!model) throw new Error(`模型 ${config.model} 未找到`)

		// Set windmill env vars for pageindex extension
		process.env.WINDMILL_URL = config.windmillUrl || 'http://ape:3900'
		process.env.WINDMILL_TOKEN = config.windmillToken || ''

		// Load pageindex extension
		const { default: pageindexExtension } = await import('./extensions/pageindex.js')
		const { default: commandsExtension } = await import('./extensions/commands.js')

		// 3. Create resource loader with extension
		const resourceLoader = new DefaultResourceLoader({
			cwd: expandHome(config.cwd),
			agentDir: getAgentDir(),
			extensionFactories: [pageindexExtension, commandsExtension],
		})
		await resourceLoader.reload()

		// 4. Create AgentSession
		const result = await createAgentSession({
			model,
			tools: [
				'read', 'bash', 'edit', 'write', 'grep', 'find',
				'qdrant_search', 'pageindex_content', 'pageindex_structure', 'es_search',
			],
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			authStorage,
		})

    piSession = result.session

    // Inject UI context so extension commands (e.g. /commands) can show dialogs
    const pendingUI = new Map()
    let uiId = 0

    piSession.bindExtensions({
      mode: 'tui',
      uiContext: {
        select: async (title, options) => new Promise((resolve) => {
          const id = ++uiId
          pendingUI.set(id, resolve)
          sendToRenderer('pi:event', { type: 'ui:select', id, title, options })
        }),
        confirm: async (title, message) => new Promise((resolve) => {
          const id = ++uiId
          pendingUI.set(id, resolve)
          sendToRenderer('pi:event', { type: 'ui:confirm', id, title, message })
        }),
        notify: (message, type) => {
          sendToRenderer('pi:event', { type: 'ui:notify', message, notifyType: type || 'info' })
        },
        input: async () => undefined,
        setStatus: () => {}, setWorkingMessage: () => {}, setWorkingVisible: () => {},
        setWorkingIndicator: () => {}, setHiddenThinkingLabel: () => {},
        setWidget: () => {}, setFooter: () => {}, setHeader: () => {}, setTitle: () => {},
        pasteToEditor: () => {}, setEditorText: () => {}, getEditorText: () => "",
        editor: async () => undefined, custom: async () => undefined,
        onTerminalInput: () => () => {},
        addAutocompleteProvider: () => {}, setEditorComponent: () => {},
        getEditorComponent: () => undefined,
        get theme() { return { colors: {}, styles: {} } },
        getAllThemes: () => [], getTheme: () => undefined,
        setTheme: () => ({ success: false, error: 'UI not available' }),
        getToolsExpanded: () => false, setToolsExpanded: () => {},
        clearMessages: () => sendToRenderer('pi:event', { type: 'ui:clear' }),
      },
    })

    ipcMain.handle('ui:response', (_event, { id, value }) => {
      const resolve = pendingUI.get(id)
      if (resolve) { resolve(value); pendingUI.delete(id) }
    })

    // 3. Forward events to renderer
    piSession.subscribe((event) => sendToRenderer('pi:event', event))
    sendToRenderer('pi:event', { type: 'agent_session_ready', sessionId: piSession.sessionId })

    return { ok: true, sessionId: piSession.sessionId }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('session:send', async (_event, message) => {
  if (!piSession) return { ok: false, error: 'session not created' }
  try {
    await piSession.prompt(message)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('session:abort', async () => {
  if (!piSession) return
  try { await piSession.abort() } catch {}
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (piSession) piSession.abort()
  app.quit()
})
