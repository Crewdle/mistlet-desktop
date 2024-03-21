const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendConfigData: (data) => ipcRenderer.send('save-config-data', data),
  getConfigData: () => ipcRenderer.invoke('get-config-data')
});
