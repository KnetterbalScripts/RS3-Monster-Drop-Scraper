const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Database operations
    loadItemDatabase: () => ipcRenderer.invoke('load-item-database'),
    
    // Scraping operations
    scrapeMonster: (url, monsterName) => ipcRenderer.invoke('scrape-monster', url, monsterName),
    
    // File operations
    saveDrops: (monsterName, drops) => ipcRenderer.invoke('save-drops', monsterName, drops),
    saveDropsLua: (monsterName, drops) => ipcRenderer.invoke('save-drops-lua', monsterName, drops),
    saveGroupLua: (monsterNames, drops) => ipcRenderer.invoke('save-group-lua', monsterNames, drops),
    showSaveDialog: (defaultPath) => ipcRenderer.invoke('show-save-dialog', defaultPath),
    
    // Debug operations
    logToMainProcess: (message) => ipcRenderer.invoke('log-to-main', message),
    
    // Utility functions
    platform: process.platform,
    version: process.versions.electron
});