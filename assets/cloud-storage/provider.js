/**
 * Cloud Storage Provider - Abstract Base Class
 * Defines the interface for cloud storage providers (Dropbox, OneDrive, etc.)
 */

class CloudStorageProvider {
  constructor(config) {
    this.config = config;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Initialize the provider with saved tokens
   * @param {Object} tokens - { accessToken, refreshToken, expiry }
   */
  initialize(tokens) {
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.tokenExpiry = tokens.expiry;
    }
  }

  /**
   * Check if the provider is authorized
   * @returns {boolean}
   */
  isAuthorized() {
    return this.accessToken && (!this.tokenExpiry || new Date() < new Date(this.tokenExpiry));
  }

  /**
   * Get the authorization URL for OAuth2 flow
   * @param {string} redirectUri - The redirect URI after authorization
   * @returns {string} Authorization URL
   */
  getAuthUrl(redirectUri) {
    throw new Error('getAuthUrl must be implemented by subclass');
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from OAuth2 callback
   * @param {string} redirectUri - The redirect URI used in authorization
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(code, redirectUri) {
    throw new Error('exchangeCodeForToken must be implemented by subclass');
  }

  /**
   * Refresh the access token
   * @returns {Promise<Object>} New token response
   */
  async refreshToken() {
    throw new Error('refreshToken must be implemented by subclass');
  }

  /**
   * Upload a file to cloud storage
   * @param {string} path - Destination path in cloud storage
   * @param {Blob|File} file - File to upload
   * @param {Function} onProgress - Progress callback (progress: number)
   * @returns {Promise<Object>} Upload response
   */
  async uploadFile(path, file, onProgress) {
    throw new Error('uploadFile must be implemented by subclass');
  }

  /**
   * Download a file from cloud storage
   * @param {string} path - Path to file in cloud storage
   * @returns {Promise<Blob>} File content
   */
  async downloadFile(path) {
    throw new Error('downloadFile must be implemented by subclass');
  }

  /**
   * List files in a directory
   * @param {string} path - Directory path
   * @returns {Promise<Array>} List of files
   */
  async listFiles(path) {
    throw new Error('listFiles must be implemented by subclass');
  }

  /**
   * Delete a file from cloud storage
   * @param {string} path - Path to file
   * @returns {Promise<void>}
   */
  async deleteFile(path) {
    throw new Error('deleteFile must be implemented by subclass');
  }

  /**
   * Get file metadata
   * @param {string} path - Path to file
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(path) {
    throw new Error('getFileMetadata must be implemented by subclass');
  }

  /**
   * Get tokens for persistence
   * @returns {Object} { accessToken, refreshToken, expiry }
   */
  getTokens() {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiry: this.tokenExpiry
    };
  }

  /**
   * Clear tokens (logout)
   */
  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Make an authenticated API request
   * @param {string} url - API endpoint URL
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>}
   */
  async authenticatedRequest(url, options = {}) {
    if (!this.isAuthorized()) {
      throw new Error('Not authorized. Please authenticate first.');
    }

    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${this.accessToken}`
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      // Token expired, try to refresh
      if (this.refreshToken) {
        await this.refreshToken();
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        return fetch(url, { ...options, headers });
      } else {
        throw new Error('Token expired and no refresh token available');
      }
    }

    return response;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CloudStorageProvider;
}
