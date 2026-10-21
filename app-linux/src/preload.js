const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('obsi', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch)
  },
  request: opts => ipcRenderer.invoke('api', opts),
  ping: () => ipcRenderer.invoke('ping'),
  sysinfo: () => ipcRenderer.invoke('sysinfo'),
  site: {
    status: () => ipcRenderer.invoke('site:status'),
    start: () => ipcRenderer.invoke('site:start'),
    stop: () => ipcRenderer.invoke('site:stop'),
    open: () => ipcRenderer.invoke('site:open')
  },
  info: () => ipcRenderer.invoke('app:info')
})
