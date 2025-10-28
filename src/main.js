const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// Disable GPU acceleration to prevent GPU process errors
app.disableHardwareAcceleration();

// Enable live reload for development
if (process.argv.includes('--dev')) {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
        hardResetMethod: 'exit'
    });
}

class MonsterScraperApp {
    constructor() {
        this.mainWindow = null;
        this.itemDatabase = null;
        this.historyPath = path.join(__dirname, '..', 'scrape-history.json');
    }

    async createWindow() {
        // Create the browser window
        this.mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1000,
            minHeight: 700,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                enableRemoteModule: false,
                preload: path.join(__dirname, 'preload.js')
            },
            icon: path.join(__dirname, '..', 'assets', 'icon.png'),
            show: true, // Show immediately
            center: true, // Center the window
            titleBarStyle: 'default',
            backgroundColor: '#1a1a1a'
        });

        // Load the app
        await this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

        // Focus and show window
        this.mainWindow.show();
        this.mainWindow.focus();
        
        // Open DevTools in development
        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }

        // Handle window closed
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });
        
        console.log('Window created and should be visible');
    }

    async loadItemDatabase() {
        try {
            const itemlistPath = path.join(__dirname, '..', 'itemlist.json');
            const data = await fs.readFile(itemlistPath, 'utf8');
            const items = JSON.parse(data);
            
            this.itemDatabase = this.processItemlistDatabase(items);
            return this.itemDatabase;
        } catch (error) {
            console.error('Failed to load itemlist.json:', error);
            throw new Error('Could not load itemlist.json. Ensure the file exists in the project root.');
        }
    }

    processItemlistDatabase(items) {
        const nameToId = {};
        const idToItem = {}; // Add mapping from ID to full item data
        let processedCount = 0;
        
        items.forEach(item => {
            if (!item.name || item.name.trim() === '') return;
            
            const originalName = item.name.toLowerCase();
            const isTradeable = !item.notTradeable && item.is_on_ge !== false;
            
            // Store full item data
            idToItem[item.id] = item;
            
            // Prioritize tradeable items - only set if not already set or if this is tradeable
            if (!nameToId[originalName] || isTradeable) {
                nameToId[originalName] = {
                    itemId: item.id,
                    isTradeable: isTradeable,
                    noteData: item.noteData // Store noted version ID if exists
                };
                processedCount++;
            }
            
            // Handle noted items
            if (originalName.includes('(noted)')) {
                const baseName = originalName.replace(/\s*\(noted\)\s*$/, '').trim();
                const notedKey = baseName + '_noted';
                if (!nameToId[notedKey] || isTradeable) {
                    nameToId[notedKey] = {
                        itemId: item.id,
                        isTradeable: isTradeable
                    };
                }
            }
        });
        
        return { items, nameToId, idToItem, type: 'itemlist' };
    }

    // === SCRAPE HISTORY FUNCTIONS ===
    
    async loadScrapeHistory() {
        try {
            const data = await fs.readFile(this.historyPath, 'utf8');
            const history = JSON.parse(data);
            return Array.isArray(history) ? history : [];
        } catch (error) {
            // File doesn't exist or is corrupted, return empty array
            return [];
        }
    }

    async saveScrapeHistory(history) {
        try {
            await fs.writeFile(this.historyPath, JSON.stringify(history, null, 2));
        } catch (error) {
            console.error('Failed to save scrape history:', error);
        }
    }

    async addToScrapeHistory(monsterName, wikiUrl) {
        try {
            const history = await this.loadScrapeHistory();
            
            // Check if already exists (case-insensitive)
            const existingIndex = history.findIndex(
                entry => entry.name.toLowerCase() === monsterName.toLowerCase()
            );
            
            const newEntry = {
                name: monsterName,
                url: wikiUrl,
                lastScraped: new Date().toISOString()
            };
            
            if (existingIndex !== -1) {
                // Update existing entry (move to top and update timestamp)
                history.splice(existingIndex, 1);
                history.unshift(newEntry);
            } else {
                // Add new entry at the beginning
                history.unshift(newEntry);
            }
            
            // No limit - keep all unique entries
            
            await this.saveScrapeHistory(history);
            return history;
        } catch (error) {
            console.error('Failed to add to scrape history:', error);
            throw error;
        }
    }

    generateLuaContent(monsterName, drops) {
        // Generate array of item IDs, using noted IDs when needed
        const itemIds = drops.map(drop => {
            if (drop.isNoted) {
                // For noted items, find the base item in the full items array and use its noteData
                const baseItemName = drop.itemName.toLowerCase().replace(/\s*\(noted\)\s*$/i, '').trim();
                
                // Find the base item in the full items array
                const baseItem = this.itemDatabase.items.find(item => 
                    item.name && item.name.toLowerCase() === baseItemName && item.noteData
                );
                
                if (baseItem && baseItem.noteData) {
                    return baseItem.noteData; // Use the noted version ID
                }
                
                // Fallback: return original ID if noted version not found
                return drop.itemId;
            }
            return drop.itemId;
        });
        
        // Sort item IDs numerically
        itemIds.sort((a, b) => a - b);
        
        // Build Lua output in same format as group export
        const luaContent = `\nlocal NPC_LIST = {\n    "${monsterName}"\n}\n\n\nlocal LOOT_LIST = {${itemIds.join(', ')}}\n`;
        
        return luaContent;
    }

    async saveGroupLua(monsterNames, drops) {
        // Header info
        const now = new Date();
        const timestamp = now.toISOString();
        
        // Sort monster names alphabetically
        const sortedNames = [...monsterNames].sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        
        // Format monster names
        const npcList = sortedNames.map(name => `    "${name}"`).join(',\n');

        // Get unique drops by itemId and isNoted
        const seenKeys = new Set();
        const uniqueDrops = drops.filter(drop => {
            // Uniek per itemId en noted-status
            const key = `${drop.itemId}_${drop.isNoted}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });

        // Map drops to correct itemId (noted ID als nodig)
        const itemIds = uniqueDrops.map(drop => {
            let finalItemId = drop.itemId;
            if (drop.isNoted) {
                const baseItemName = drop.itemName.toLowerCase().replace(/\s*\(noted\)\s*$/i, '').trim();
                const baseItem = this.itemDatabase.items.find(item => 
                    item.name && item.name.toLowerCase() === baseItemName && item.noteData
                );
                if (baseItem && baseItem.noteData) {
                    finalItemId = baseItem.noteData;
                }
            }
            return finalItemId;
        });

        // Sort item IDs numerically
        itemIds.sort((a, b) => a - b);

        // Build Lua output in requested format
        const luaContent = `\nlocal NPC_LIST = {\n${npcList}\n}\n\n\nlocal LOOT_LIST = {${itemIds.join(', ')}}\n`;
        const fileName = `group__${monsterNames.length}_monsters__drops.lua`;
        const filePath = path.join(__dirname, '..', 'drops', fileName);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, luaContent);
        return filePath;
    }

    setupIpcHandlers() {
        // Load item database
        ipcMain.handle('load-item-database', async () => {
            if (!this.itemDatabase) {
                await this.loadItemDatabase();
            }
            return {
                nameToId: this.itemDatabase.nameToId,
                items: this.itemDatabase.items, // Include full items array
                itemCount: this.itemDatabase.items.length,
                type: this.itemDatabase.type
            };
        });

        // === HISTORY OPERATIONS ===
        
        ipcMain.handle('load-scrape-history', async () => {
            return await this.loadScrapeHistory();
        });

        ipcMain.handle('add-to-scrape-history', async (event, monsterName, wikiUrl) => {
            return await this.addToScrapeHistory(monsterName, wikiUrl);
        });

        // Scrape monster from wiki
        ipcMain.handle('scrape-monster', async (event, url, monsterName) => {
            try {
                
                // Use native https module instead of external dependencies
                const https = require('https');
                const http = require('http');
                const { URL } = require('url');
                
                // Parse URL
                const parsedUrl = new URL(url);
                const isHttps = parsedUrl.protocol === 'https:';
                const requestModule = isHttps ? https : http;
                
                // Create promise-based request
                const html = await new Promise((resolve, reject) => {
                    const options = {
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port || (isHttps ? 443 : 80),
                        path: parsedUrl.pathname + parsedUrl.search,
                        method: 'GET',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                        }
                    };
                    
                    const req = requestModule.request(options, (res) => {
                        let data = '';
                        
                        res.on('data', (chunk) => {
                            data += chunk;
                        });
                        
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                resolve(data);
                            } else {
                                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                            }
                        });
                    });
                    
                    req.on('error', (error) => {
                        reject(error);
                    });
                    
                    req.setTimeout(30000, () => {
                        req.destroy();
                        reject(new Error('Request timeout'));
                    });
                    
                    req.end();
                });
                
                // Targeted parsing: only parse tables that contain both "Item" and "Quantity" headers
                const drops = [];
                const seen = new Set();

                const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
                const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
                const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
                const imgNotedRegex = /<img[^>]*alt[^>]*noted[^>]*>/i;

                let tableMatch;
                while ((tableMatch = tableRegex.exec(html)) !== null) {
                    const tableHtml = tableMatch[1];

                    // Find header row that contains both 'item' and 'quantity'
                    let headerFound = false;
                    const headers = [];
                    let trMatchHeader;
                    rowRegex.lastIndex = 0;
                    while ((trMatchHeader = rowRegex.exec(tableHtml)) !== null) {
                        const rowHtml = trMatchHeader[1];
                        // collect header-like cells
                        cellRegex.lastIndex = 0;
                        const cells = [];
                        let cMatch;
                        while ((cMatch = cellRegex.exec(rowHtml)) !== null) {
                            cells.push(cMatch[1].replace(/<[^>]*>/g, ' ').trim());
                        }

                        if (cells.length > 0) {
                            const joined = cells.join(' ').toLowerCase();
                            if (joined.includes('item') && joined.includes('quantity')) {
                                headerFound = true;
                                // store headers for column index lookup
                                for (const h of cells) headers.push(h.toLowerCase());
                                break;
                            }
                        }
                    }

                    if (!headerFound) continue; // skip non-drop tables

                    // determine column indices
                    const itemColIndex = headers.findIndex(h => h.includes('item'));
                    const quantityColIndex = headers.findIndex(h => h.includes('quantity'));

                    // parse all rows in this table and extract item/quantity
                    let trMatch;
                    rowRegex.lastIndex = 0;
                    while ((trMatch = rowRegex.exec(tableHtml)) !== null) {
                        const rowHtml = trMatch[1];

                        // skip header rows (containing <th> or the header we already found)
                        if (/<th/i.test(rowHtml)) continue;

                        // extract cells
                        cellRegex.lastIndex = 0;
                        const cells = [];
                        let cc;
                        while ((cc = cellRegex.exec(rowHtml)) !== null) {
                            cells.push(cc[1]);
                        }

                        if (!cells || cells.length === 0) continue;

                        // get item cell text
                        const rawItemCell = (itemColIndex >= 0 && itemColIndex < cells.length) ? cells[itemColIndex] : cells[0];
                        const rawQuantityCell = (quantityColIndex >= 0 && quantityColIndex < cells.length) ? cells[quantityColIndex] : null;

                        // Clean HTML tags and decode entities for item
                        const cleanItemText = rawItemCell
                            .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
                            .replace(/&nbsp;/g, ' ')   // Replace nbsp
                            .replace(/&amp;/g, '&')    // Replace amp
                            .replace(/&lt;/g, '<')     // Replace lt
                            .replace(/&gt;/g, '>')     // Replace gt
                            .replace(/\s+/g, ' ')     // Normalize whitespace
                            .trim();

                        if (!cleanItemText || cleanItemText.length < 2) continue;

                        // Determine noted via quantity cell or item cell or images
                        let isNoted = false;
                        if (rawQuantityCell) {
                            const qText = rawQuantityCell.replace(/<[^>]*>/g, ' ').toLowerCase();
                            if (qText.includes('noted')) isNoted = true;
                        }
                        if (!isNoted && cleanItemText.toLowerCase().includes('(noted)')) isNoted = true;
                        if (!isNoted && imgNotedRegex.test(rawItemCell)) isNoted = true;

                        // If noted detected but not in name, append for consistency
                        let finalItemName = cleanItemText;
                        if (isNoted && !finalItemName.toLowerCase().includes('(noted)')) {
                            finalItemName = finalItemName + ' (noted)';
                        }

                        // Basic item name validation
                        if (!finalItemName.match(/^[A-Za-z][A-Za-z0-9\s\(\)'-]{1,}$/)) continue;

                        const itemKey = `${finalItemName.toLowerCase()}_${isNoted}`;
                        if (!seen.has(itemKey)) {
                            seen.add(itemKey);
                            drops.push({ itemName: finalItemName, isNoted: isNoted });
                        }
                    }
                }

                return drops;
                
            } catch (error) {
                console.error(`Error scraping ${monsterName}:`, error);
                throw new Error(`Failed to scrape ${monsterName}: ${error.message}`);
            }
        });

        // Save drops to file
        ipcMain.handle('save-drops', async (event, monsterName, drops) => {
            try {
                const fileName = `${monsterName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_drops.json`;
                const filePath = path.join(__dirname, '..', 'drops', fileName);
                
                // Ensure drops directory exists
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                
                // Clean drops for JSON but use correct noted IDs
                const cleanDrops = drops.map(drop => {
                    let finalItemId = drop.itemId;
                    
                    // For noted items, use the noted ID
                    if (drop.isNoted) {
                        const baseItemName = drop.itemName.toLowerCase();
                        const baseItem = this.itemDatabase.items.find(item => 
                            item.name && item.name.toLowerCase() === baseItemName && item.noteData
                        );
                        
                        if (baseItem && baseItem.noteData) {
                            finalItemId = baseItem.noteData;
                        }
                    }
                    
                    return {
                        itemName: drop.itemName,
                        itemId: finalItemId
                    };
                });
                
                const output = {
                    monster: monsterName,
                    scrapedAt: new Date().toISOString(),
                    totalFoundDrops: cleanDrops.length,
                    drops: cleanDrops
                };
                
                await fs.writeFile(filePath, JSON.stringify(output, null, 2));
                return filePath;
            } catch (error) {
                console.error('Error saving drops:', error);
                throw new Error(`Failed to save drops: ${error.message}`);
            }
        });

        // Save drops to Lua file
        ipcMain.handle('save-drops-lua', async (event, monsterName, drops) => {
            try {
                const fileName = `${monsterName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_drops.lua`;
                const filePath = path.join(__dirname, '..', 'drops', fileName);
                
                // Ensure drops directory exists
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                
                // Generate Lua table format
                const luaContent = this.generateLuaContent(monsterName, drops);
                
                await fs.writeFile(filePath, luaContent);
                return filePath;
            } catch (error) {
                console.error('Error saving Lua drops:', error);
                throw new Error(`Failed to save Lua drops: ${error.message}`);
            }
        });

        // Save group drops to Lua file
        ipcMain.handle('save-group-lua', async (event, monsterNames, drops) => {
            return await this.saveGroupLua(monsterNames, drops);
        });

        // Show save dialog
        ipcMain.handle('show-save-dialog', async (event, defaultPath) => {
            const result = await dialog.showSaveDialog(this.mainWindow, {
                defaultPath: defaultPath,
                filters: [
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });
            return result;
        });

        // Debug logging
        ipcMain.handle('log-to-main', async (event, message) => {
            console.log(`[RENDERER] ${message}`);
        });
    }

    async initialize() {
        try {
            this.setupIpcHandlers(); // Setup handlers before creating window
            await this.createWindow();
            await this.loadItemDatabase();
            console.log('App initialized successfully');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            app.quit();
        }
    }
}

// App event handlers
app.whenReady().then(async () => {
    const scraperApp = new MonsterScraperApp();
    await scraperApp.initialize();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        const scraperApp = new MonsterScraperApp();
        await scraperApp.initialize();
    }
});

// Handle certificate errors (for HTTPS requests)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
});