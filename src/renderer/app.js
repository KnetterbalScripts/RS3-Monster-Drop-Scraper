class MonsterScraperApp {
    constructor() {
        this.monsterQueue = [];
        this.isScrapingActive = false;
        this.itemDatabase = null;
        
        this.initializeApp();
    }

    async initializeApp() {
        try {
            // Initialize UI elements
            this.initializeElements();
            this.setupEventListeners();
            
            // Load item database
            await this.loadItemDatabase();
            
            // Set version info
            this.setVersionInfo();
            
            console.log('App initialized successfully');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showStatus('Failed to initialize app: ' + error.message, 'error');
        }
    }

    initializeElements() {
        // Input elements
        this.monsterNameInput = document.getElementById('monsterName');
        this.monsterUrlInput = document.getElementById('monsterUrl');
        this.addToQueueBtn = document.getElementById('addToQueue');
        this.scrapeBtn = document.getElementById('scrapeButton');
        
        // Display elements
        this.queueSection = document.getElementById('queueSection');
        this.queueList = document.getElementById('queueList');
        this.statusMessage = document.getElementById('statusMessage');
        this.progressContainer = document.getElementById('progressContainer');
        this.progressBar = document.getElementById('progressBar');
        this.progressText = document.getElementById('progressText');
        this.resultsSection = document.getElementById('resultsSection');
        this.resultsList = document.getElementById('resultsList');
        
        // Info elements
        this.databaseStatus = document.getElementById('database-status');
        this.databaseInfo = document.getElementById('databaseInfo');
        this.electronVersion = document.getElementById('electronVersion');
    }

    setupEventListeners() {
        // Button events
        this.addToQueueBtn.addEventListener('click', () => this.addToQueue());
        this.scrapeBtn.addEventListener('click', () => this.startScraping());
        
        // Example buttons
        document.querySelectorAll('.example-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = e.target.dataset.name;
                const url = e.target.dataset.url;
                this.fillExample(name, url);
            });
        });
        
        // Enter key support
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.isScrapingActive) {
                this.addToQueue();
            }
        });
    }

    async loadItemDatabase() {
        try {
            this.showStatus('Loading item database...', 'info');
            this.databaseStatus.textContent = 'Loading database...';
            
            const dbInfo = await window.electronAPI.loadItemDatabase();
            this.itemDatabase = dbInfo;
            
            const statusText = `✅ Database loaded: ${dbInfo.itemCount.toLocaleString()} items (${dbInfo.type})`;
            this.databaseStatus.textContent = statusText;
            this.databaseInfo.textContent = `Database: ${dbInfo.itemCount.toLocaleString()} items (${dbInfo.type})`;
            
            this.showStatus(statusText, 'success');
            
            console.log('Item database loaded:', dbInfo);
        } catch (error) {
            console.error('Failed to load item database:', error);
            const errorMsg = 'Failed to load item database: ' + error.message;
            this.databaseStatus.textContent = '❌ ' + errorMsg;
            this.showStatus(errorMsg, 'error');
        }
    }

    setVersionInfo() {
        if (window.electronAPI && window.electronAPI.version) {
            this.electronVersion.textContent = window.electronAPI.version;
        }
    }

    fillExample(name, url) {
        this.monsterNameInput.value = name;
        this.monsterUrlInput.value = url;
        
        // Add visual feedback
        this.monsterNameInput.style.borderColor = '#ff6b35';
        this.monsterUrlInput.style.borderColor = '#ff6b35';
        
        setTimeout(() => {
            this.monsterNameInput.style.borderColor = '';
            this.monsterUrlInput.style.borderColor = '';
        }, 1000);
    }

    addToQueue() {
        const name = this.monsterNameInput.value.trim();
        const url = this.monsterUrlInput.value.trim();
        
        if (!name || !url) {
            this.showStatus('Please fill in both monster name and URL', 'warning');
            return;
        }
        
        if (!url.includes('runescape.wiki')) {
            this.showStatus('Please use a valid RuneScape Wiki URL', 'warning');
            return;
        }
        
        // Check for duplicates
        if (this.monsterQueue.some(monster => monster.url === url)) {
            this.showStatus('This monster is already in the queue', 'warning');
            return;
        }
        
        // Add to queue
        this.monsterQueue.push({ name, url });
        this.updateQueueDisplay();
        
        // Clear inputs
        this.monsterNameInput.value = '';
        this.monsterUrlInput.value = '';
        
        this.showStatus(`Added "${name}" to queue`, 'success');
    }

    removeFromQueue(index) {
        const monster = this.monsterQueue[index];
        this.monsterQueue.splice(index, 1);
        this.updateQueueDisplay();
        this.showStatus(`Removed "${monster.name}" from queue`, 'info');
    }

    updateQueueDisplay() {
        if (this.monsterQueue.length === 0) {
            this.queueSection.style.display = 'none';
            return;
        }
        
        this.queueSection.style.display = 'block';
        this.queueList.innerHTML = '';
        
        this.monsterQueue.forEach((monster, index) => {
            const queueItem = document.createElement('div');
            queueItem.className = 'queue-item fade-in';
            queueItem.innerHTML = `
                <div class="queue-item-info">
                    <div class="queue-item-name">${this.escapeHtml(monster.name)}</div>
                    <div class="queue-item-url">${this.escapeHtml(monster.url)}</div>
                </div>
                <button class="queue-item-remove" onclick="app.removeFromQueue(${index})">Remove</button>
            `;
            this.queueList.appendChild(queueItem);
        });
    }

    async startScraping() {
        // Add current input to queue if filled
        const name = this.monsterNameInput.value.trim();
        const url = this.monsterUrlInput.value.trim();
        
        if (name && url && !this.monsterQueue.some(m => m.url === url)) {
            this.addToQueue();
        }
        
        if (this.monsterQueue.length === 0) {
            this.showStatus('Please add at least one monster to the queue', 'warning');
            return;
        }
        
        if (this.isScrapingActive) {
            this.showStatus('Scraping is already in progress', 'warning');
            return;
        }
        
        if (!this.itemDatabase) {
            this.showStatus('Item database not loaded. Please wait...', 'error');
            return;
        }
        
        this.isScrapingActive = true;
        this.scrapeBtn.disabled = true;
        this.addToQueueBtn.disabled = true;
        
        try {
            this.showProgress(0);
            this.resultsSection.style.display = 'none';
            this.resultsList.innerHTML = '';
            
            const results = [];
            const totalMonsters = this.monsterQueue.length;
            
            for (let i = 0; i < this.monsterQueue.length; i++) {
                const monster = this.monsterQueue[i];
                const progress = Math.round(((i + 1) / totalMonsters) * 100);
                
                this.showStatus(`🔍 Scraping ${monster.name} (${i + 1}/${totalMonsters})...`, 'info');
                this.showProgress(progress);
                
                try {
                    const drops = await window.electronAPI.scrapeMonster(monster.url, monster.name);
                    
                    const linkedDrops = this.linkItemsToIds(drops);
                    
                    results.push({
                        monster: monster.name,
                        url: monster.url,
                        scrapedAt: new Date().toISOString(),
                        totalFoundDrops: linkedDrops.length,
                        drops: linkedDrops
                    });
                    
                } catch (error) {
                    console.error(`Error scraping ${monster.name}:`, error);
                    results.push({
                        monster: monster.name,
                        url: monster.url,
                        error: error.message,
                        scrapedAt: new Date().toISOString(),
                        totalFoundDrops: 0,
                        drops: []
                    });
                }
            }
            
            this.showProgress(100);
            this.displayResults(results);
            
            // Auto-save all results
            for (const result of results) {
                if (result.drops.length > 0) {
                    try {
                        await window.electronAPI.saveDrops(result.monster, result.drops);
                    } catch (error) {
                        console.error(`Failed to save ${result.monster}:`, error);
                    }
                }
            }
            
            this.showStatus(`✅ Completed scraping ${totalMonsters} monsters`, 'success');
            
        } catch (error) {
            console.error('Scraping process failed:', error);
            this.showStatus('Scraping failed: ' + error.message, 'error');
        } finally {
            this.isScrapingActive = false;
            this.scrapeBtn.disabled = false;
            this.addToQueueBtn.disabled = false;
            this.progressContainer.style.display = 'none';
        }
    }

    linkItemsToIds(drops) {
        if (!this.itemDatabase || !this.itemDatabase.nameToId) {
            console.warn('No item database available for linking');
            return drops.map(drop => ({ ...drop, itemId: null }));
        }
        

        const { nameToId } = this.itemDatabase;
        const linkedDrops = [];
        const seenUniqueItems = new Set(); // Track base_name + noted status
        const seenIds = new Set();
        
        for (const drop of drops) {
            const baseItemName = drop.itemName.toLowerCase().trim()
                .replace(/\s*\(noted\)\s*$/i, '').trim();
            const isNoted = drop.itemName.toLowerCase().includes('(noted)') || drop.isNoted;
            
            
            // Create unique key: base name + noted status
            const uniqueKey = `${baseItemName}_${isNoted ? 'noted' : 'unnoted'}`;
            
            // Skip if we already have this exact combination
            if (seenUniqueItems.has(uniqueKey)) {
                continue;
            }
            
            // For noted items, try to find the noted version first
            let itemId;
            if (isNoted) {
                // For noted items, try specific noted patterns with tradeable priority
                itemId = this.findBestItemId(drop.itemName, nameToId); // This uses findTradeableItemId internally
                
                // If no noted version found, try to find the unnoted and calculate noted ID
                if (!itemId) {
                    const unnotedId = this.findBestItemId(baseItemName, nameToId);
                    if (unnotedId) {
                        // For RuneScape, noted versions are typically unnoted_id + 1
                        const potentialNotedId = unnotedId + 1;
                        // Verify this noted ID exists in our database
                        if (this.itemDatabase.items && this.itemDatabase.items.find(item => item.id === potentialNotedId)) {
                            itemId = potentialNotedId;
                        }
                    }
                }
            } else {
                // For unnoted items, find the base item (already prioritizes tradeable)
                itemId = this.findBestItemId(drop.itemName, nameToId);
            }
            
            if (itemId && !seenUniqueItems.has(uniqueKey)) {
                // Clean item name (remove noted suffix for consistency)
                const cleanItemName = drop.itemName.replace(/\s*\(noted\)\s*$/i, '').trim();
                const wasNoted = drop.itemName.toLowerCase().includes('(noted)');
                
                linkedDrops.push({
                    itemName: cleanItemName,
                    itemId: itemId,
                    isNoted: wasNoted  // Keep noted info for Lua comments
                });
                seenIds.add(itemId);
                seenUniqueItems.add(uniqueKey);
            }
        }
        
        
        return linkedDrops;
    }

    findBestItemId(itemName, nameToId) {
        if (!itemName || !nameToId) return null;
        
        const cleanItemName = itemName.toLowerCase().trim();
        
        // If we have access to the full items database, do smart tradeable lookup
        if (this.itemDatabase && this.itemDatabase.items) {
            return this.findTradeableItemId(itemName, this.itemDatabase.items);
        }
        
        // Fallback to nameToId lookup (already prioritizes tradeable items)
        let itemData = nameToId[cleanItemName];
        if (itemData) {
            return itemData.itemId || itemData; // Handle both object and direct ID formats
        }
        
        // Try variations
        const variations = [
            cleanItemName.replace(/\s+/g, ' '), // normalize spaces
            cleanItemName.replace(/['']/g, "'"), // normalize apostrophes
            cleanItemName.replace(/\(.*?\)/g, '').trim(), // remove parentheses
            cleanItemName.replace(/\s*(noted)\s*$/i, '').trim(), // remove noted
        ];
        
        for (const variation of variations) {
            const varData = nameToId[variation];
            if (varData) {
                return varData.itemId || varData; // Handle both object and direct ID formats
            }
        }
        
        return null;
    }
    
    findTradeableItemId(itemName, items) {
        const cleanItemName = itemName.toLowerCase().trim();
        const searchName = cleanItemName.replace(/\s*\(noted\)\s*$/i, '').trim();
        
        // Find all items that match this name
        const matchingItems = items.filter(item => {
            if (!item.name) return false;
            const itemNameLower = item.name.toLowerCase();
            const baseItemName = itemNameLower.replace(/\s*\(noted\)\s*$/i, '').trim();
            
            return baseItemName === searchName || itemNameLower === cleanItemName;
        });
        
        if (matchingItems.length === 0) {
            return null;
        }
        
        // Sort by preference with special cases
        matchingItems.sort((a, b) => {
            const aIsTradeable = !a.notTradeable && a.is_on_ge !== false;
            const bIsTradeable = !b.notTradeable && b.is_on_ge !== false;
            
            // Special case: For charms, prefer lower ID (original versions, not dungeoneering)
            const isCharm = searchName.includes('charm');
            if (isCharm) {
                return a.id - b.id; // Lower ID first for charms
            }
            
            // For other items: tradeable items first
            if (aIsTradeable && !bIsTradeable) return -1;
            if (!aIsTradeable && bIsTradeable) return 1;
            
            // If both tradeable or both non-tradeable, prefer lower ID (earlier/more common)
            return a.id - b.id;
        });
        
        const bestItem = matchingItems[0];
        const isTradeable = !bestItem.notTradeable && bestItem.is_on_ge !== false;
        
        return bestItem.id;
    }

    displayResults(results) {
        this.resultsSection.style.display = 'block';
        this.resultsList.innerHTML = '';
        
        results.forEach((result, index) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item fade-in';
            
            const statusClass = result.error ? 'error' : (result.totalFoundDrops > 0 ? 'success' : 'warning');
            const statusIcon = result.error ? '❌' : (result.totalFoundDrops > 0 ? '✅' : '⚠️');
            
            resultItem.innerHTML = `
                <div class="result-header">
                    <div>
                        <div class="result-monster">${statusIcon} ${this.escapeHtml(result.monster)}</div>
                        <div class="result-stats">
                            ${result.error ? `Error: ${this.escapeHtml(result.error)}` : 
                              `Found ${result.totalFoundDrops} unique items`}
                        </div>
                    </div>
                    <div class="result-actions">
                        ${result.totalFoundDrops > 0 ? `
                            <button class="btn btn-secondary" onclick="app.downloadResult(${index})">
                                💾 Download JSON
                            </button>
                            <button class="btn btn-secondary" onclick="app.downloadResultLua(${index})">
                                📄 Download Lua
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
            
            this.resultsList.appendChild(resultItem);
        });
        
        // Store results for download
        this.lastResults = results;
    }

    async downloadResult(index) {
        if (!this.lastResults || !this.lastResults[index]) return;
        
        const result = this.lastResults[index];
        const fileName = `${result.monster.toLowerCase().replace(/[^a-z0-9]/g, '_')}_drops.json`;
        
        try {
            const filePath = await window.electronAPI.saveDrops(result.monster, result.drops);
            this.showStatus(`✅ Saved ${result.monster} drops to: ${filePath}`, 'success');
        } catch (error) {
            console.error('Failed to save file:', error);
            this.showStatus('Failed to save file: ' + error.message, 'error');
        }
    }

    async downloadResultLua(index) {
        if (!this.lastResults || !this.lastResults[index]) return;
        
        const result = this.lastResults[index];
        const fileName = `${result.monster.toLowerCase().replace(/[^a-z0-9]/g, '_')}_drops.lua`;
        
        try {
            const filePath = await window.electronAPI.saveDropsLua(result.monster, result.drops);
            this.showStatus(`✅ Saved ${result.monster} drops to Lua: ${filePath}`, 'success');
        } catch (error) {
            console.error('Failed to save Lua file:', error);
            this.showStatus('Failed to save Lua file: ' + error.message, 'error');
        }
    }

    showStatus(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (this.statusMessage.textContent === message) {
                    this.statusMessage.textContent = '';
                    this.statusMessage.className = 'status-message';
                }
            }, 5000);
        }
    }

    showProgress(percentage) {
        this.progressContainer.style.display = 'flex';
        this.progressBar.style.width = percentage + '%';
        this.progressText.textContent = percentage + '%';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MonsterScraperApp();
});