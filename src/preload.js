const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  createSession: (config) => ipcRenderer.invoke('session:create', config),
  sendMessage: (text) => ipcRenderer.invoke('session:send', text),
  abort: () => ipcRenderer.invoke('session:abort'),
  onEvent: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('pi:event', handler)
    return () => ipcRenderer.removeListener('pi:event', handler)
  },
})
