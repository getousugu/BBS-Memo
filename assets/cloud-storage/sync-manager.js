/**
 * Sync Manager
 * Manages cloud storage synchronization with conflict resolution
 */

class SyncManager {
  constructor(db) {
    this.db = db;
    this.provider = null;
    this.syncMode = 'bidirectional'; // bidirectional, backup, restore
    this.syncOptions = {
      boards: true,
      threads: true,
      posts: true,
      files: true,
      settings: true,
      archives: true
    };
    this.syncMetadata = {
      lastSyncTime: null,
      version: '1.0.0'
    };
  }

  /**
   * Set the cloud storage provider
   * @param {CloudStorageProvider} provider - Cloud storage provider instance
   */
  setProvider(provider) {
    this.provider = provider;
  }

  /**
   * Set sync mode
   * @param {string} mode - Sync mode (bidirectional, backup, restore)
   */
  setSyncMode(mode) {
    this.syncMode = mode;
  }

  /**
   * Set sync options
   * @param {Object} options - Sync options
   */
  setSyncOptions(options) {
    this.syncOptions = { ...this.syncOptions, ...options };
  }

  /**
   * Export all data to ZIP format
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Blob>} ZIP file blob
   */
  async exportData(onProgress) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library is required');
    }

    const zip = new JSZip();
    const data = {};

    // Helper: safely get all records from a store (skips if store doesn't exist)
    const safeGetAll = async (storeName) => {
      try {
        return await this.db.getAll(storeName);
      } catch (e) {
        console.warn(`[SyncManager] Store '${storeName}' not found, skipping.`, e.message);
        return [];
      }
    };

    // Export boards
    if (this.syncOptions.boards) {
      data.boards = await safeGetAll('boards');
    }

    // Export threads
    if (this.syncOptions.threads) {
      data.threads = await safeGetAll('threads');
    }

    // Export posts
    if (this.syncOptions.posts) {
      data.posts = await safeGetAll('posts');
    }

    // Export files
    if (this.syncOptions.files) {
      const files = await safeGetAll('files');
      data.files = files;

      if (files.length > 0) {
        // Add files to ZIP
        const filesFolder = zip.folder('files');
        for (const file of files) {
          try {
            const base64Data = file.content.split(',')[1];
            const binaryData = atob(base64Data);
            const bytes = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
              bytes[i] = binaryData.charCodeAt(i);
            }
            filesFolder.file(`${file.id}_${file.name}`, bytes);
          } catch (e) {
            console.error('Failed to add file to ZIP:', file.name, e);
          }
        }
      }
    }

    // Export settings
    if (this.syncOptions.settings) {
      data.settings = await safeGetAll('settings');
    }

    // Export archives
    if (this.syncOptions.archives) {
      data.archived_threads = await safeGetAll('archived_threads');
    }

    // Add metadata
    const metadata = {
      version: this.syncMetadata.version,
      exportTime: new Date().toISOString(),
      lastSyncTime: this.syncMetadata.lastSyncTime,
      syncOptions: this.syncOptions
    };

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));
    zip.file('data.json', JSON.stringify(data, null, 2));

    // Generate ZIP
    const blob = await zip.generateAsync({ type: 'blob' }, onProgress);
    return blob;
  }

  /**
   * Import data from ZIP format
   * @param {Blob} zipBlob - ZIP file blob
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Import result
   */
  async importData(zipBlob, onProgress) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library is required');
    }

    const zip = await JSZip.loadAsync(zipBlob);
    const result = {
      merged: 0,
      overwritten: 0,
      conflicts: 0,
      errors: []
    };

    // Load metadata
    const metadataFile = zip.file('metadata.json');
    if (!metadataFile) {
      throw new Error('Invalid sync file: missing metadata.json');
    }

    const metadata = JSON.parse(await metadataFile.async('string'));
    this.syncMetadata.lastSyncTime = metadata.exportTime;

    // Load data
    const dataFile = zip.file('data.json');
    if (!dataFile) {
      throw new Error('Invalid sync file: missing data.json');
    }

    const data = JSON.parse(await dataFile.async('string'));

    // Import boards
    if (this.syncOptions.boards && data.boards) {
      await this.importItems('boards', data.boards, result);
    }

    // Import threads
    if (this.syncOptions.threads && data.threads) {
      await this.importItems('threads', data.threads, result);
    }

    // Import posts
    if (this.syncOptions.posts && data.posts) {
      await this.importItems('posts', data.posts, result);
    }

    // Import files
    if (this.syncOptions.files && data.files) {
      await this.importItems('files', data.files, result);
      
      // Load file contents from ZIP
      const filesFolder = zip.folder('files');
      if (filesFolder) {
        for (const file of data.files) {
          const fileEntry = filesFolder.file(`${file.id}_${file.name}`);
          if (fileEntry) {
            const content = await fileEntry.async('base64');
            file.content = `data:${file.type || 'application/octet-stream'};base64,${content}`;
            await this.db.put('files', file);
          }
        }
      }
    }

    // Import settings
    if (this.syncOptions.settings && data.settings) {
      await this.importItems('settings', data.settings, result);
    }

    // Import archives
    if (this.syncOptions.archives && data.archived_threads) {
      await this.importItems('archived_threads', data.archived_threads, result);
    }

    return result;
  }

  /**
   * Import items with conflict resolution
   * @param {string} storeName - IndexedDB store name
   * @param {Array} items - Items to import
   * @param {Object} result - Import result object
   */
  async importItems(storeName, items, result) {
    // Check if the store exists before iterating
    if (this.db.db && !this.db.db.objectStoreNames.contains(storeName)) {
      console.warn(`[SyncManager] Import skipped: store '${storeName}' does not exist in this DB version.`);
      return;
    }

    for (const item of items) {
      try {
        const existing = await this.db.get(storeName, item.id);

        if (existing) {
          // Conflict resolution based on timestamp
          const existingTime = new Date(existing.updatedAt || existing.createdAt || existing.updated_at || existing.created_at || existing.lastPostAt || 0);
          const newTime = new Date(item.updatedAt || item.createdAt || item.updated_at || item.created_at || item.lastPostAt || 0);

          if (this.syncMode === 'restore' || newTime > existingTime) {
            await this.db.put(storeName, item);
            result.overwritten++;
          } else {
            result.merged++;
          }
        } else {
          await this.db.put(storeName, item);
          result.merged++;
        }
      } catch (e) {
        result.errors.push({ item: item.id, error: e.message });
      }
    }
  }

  /**
   * Perform sync operation
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Sync result
   */
  async sync(onProgress) {
    if (!this.provider || !this.provider.isAuthorized()) {
      throw new Error('Provider not authorized');
    }

    const result = {
      mode: this.syncMode,
      uploaded: false,
      downloaded: false,
      conflicts: 0,
      errors: []
    };

    const syncPath = '/BBS-Memo';
    const timestamp = Date.now();
    const filename = `bbs-memo-sync-${timestamp}.zip`;
    const fullPath = `${syncPath}/${filename}`;

    try {
      if (this.syncMode === 'backup' || this.syncMode === 'bidirectional') {
        // Upload local data to cloud
        onProgress && onProgress(10, 'Exporting data...');
        const zipBlob = await this.exportData((percent) => {
          onProgress && onProgress(10 + percent * 0.4, 'Exporting data...');
        });

        onProgress && onProgress(50, 'Uploading to cloud...');
        await this.provider.uploadFile(fullPath, zipBlob);
        result.uploaded = true;

        // Clean up old sync files (keep last 5)
        onProgress && onProgress(70, 'Cleaning up old files...');
        await this.cleanupOldSyncFiles(syncPath, 5);
      }

      if (this.syncMode === 'restore' || this.syncMode === 'bidirectional') {
        // Download data from cloud
        onProgress && onProgress(80, 'Downloading from cloud...');
        let files = [];
        try {
          files = await this.provider.listFiles(syncPath);
        } catch (e) {
          console.warn('Could not list files for download, assuming empty:', e);
        }
        
        if (files.length > 0) {
          // Get the most recent file
          const latestFile = files
            .filter(f => f.name.startsWith('bbs-memo-sync-') && f.name.endsWith('.zip'))
            .sort((a, b) => new Date(b.client_modified) - new Date(a.client_modified))[0];

          if (latestFile) {
            const latestPath = `${syncPath}/${latestFile.name}`;
            const zipBlob = await this.provider.downloadFile(latestPath);

            onProgress && onProgress(90, 'Importing data...');
            const importResult = await this.importData(zipBlob);
            result.downloaded = true;
            result.conflicts = importResult.conflicts;
            result.errors = importResult.errors;
          }
        }
      }

      // Update sync metadata
      this.syncMetadata.lastSyncTime = new Date().toISOString();
      onProgress && onProgress(100, 'Sync complete');

    } catch (error) {
      result.errors.push({ error: error.message });
      throw error;
    }

    return result;
  }

  /**
   * Clean up old sync files
   * @param {string} path - Directory path
   * @param {number} keepCount - Number of files to keep
   */
  async cleanupOldSyncFiles(path, keepCount) {
    try {
      let files = [];
      try {
        files = await this.provider.listFiles(path);
      } catch (e) {
        return; // Skip if directory doesn't exist yet
      }
      const syncFiles = files
        .filter(f => f.name.startsWith('bbs-memo-sync-') && f.name.endsWith('.zip'))
        .sort((a, b) => new Date(b.client_modified) - new Date(a.client_modified));

      // Delete old files beyond keepCount
      for (let i = keepCount; i < syncFiles.length; i++) {
        const filePath = `${path}/${syncFiles[i].name}`;
        await this.provider.deleteFile(filePath);
      }
    } catch (e) {
      console.error('Failed to cleanup old sync files:', e);
    }
  }

  /**
   * Get sync status
   * @returns {Object} Sync status
   */
  getSyncStatus() {
    return {
      provider: this.provider ? this.provider.constructor.name : null,
      authorized: this.provider ? this.provider.isAuthorized() : false,
      mode: this.syncMode,
      options: this.syncOptions,
      lastSyncTime: this.syncMetadata.lastSyncTime
    };
  }

  /**
   * Load sync metadata from IndexedDB
   */
  async loadMetadata() {
    try {
      const metadata = await this.db.get('settings', 'cloud_sync_metadata');
      if (metadata) {
        this.syncMetadata = metadata.value;
      }
    } catch (e) {
      console.error('Failed to load sync metadata:', e);
    }
  }

  /**
   * Save sync metadata to IndexedDB
   */
  async saveMetadata() {
    try {
      await this.db.put('settings', {
        key: 'cloud_sync_metadata',
        value: this.syncMetadata
      });
    } catch (e) {
      console.error('Failed to save sync metadata:', e);
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
}
