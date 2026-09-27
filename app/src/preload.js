const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('obsi', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch)
  },
  request: opts => ipcRenderer.invoke('api', opts),
  vault: {
    push: opts => ipcRenderer.invoke('vault:push', opts),
    pull: opts => ipcRenderer.invoke('vault:pull', opts),
    remove: opts => ipcRenderer.invoke('vault:delete', opts)
  },
  dialog: {
    sources: () => ipcRenderer.invoke('dialog:sources'),
    saveDir: () => ipcRenderer.invoke('dialog:saveDir')
  },
  shell: { reveal: p => ipcRenderer.invoke('shell:reveal', p) },
  readImage: p => ipcRenderer.invoke('image:data', p),
  pathForFile: file => {
    try { return webUtils.getPathForFile(file) } catch { return null }
  },
  info: () => ipcRenderer.invoke('app:info'),
  onProgress: cb => {
    ipcRenderer.on('vault:progress', (_e, data) => cb(data))
  }
})
