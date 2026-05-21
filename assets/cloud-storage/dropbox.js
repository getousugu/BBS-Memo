/**
 * Dropbox Cloud Storage Provider
 * Implements Dropbox API v2 for file upload/download
 * Uses PKCE flow for secure authentication without client_secret
 */

class DropboxProvider extends CloudStorageProvider {
  constructor(config) {
    super(config);
    this.apiBaseUrl = 'https://api.dropboxapi.com/2';
    this.contentBaseUrl = 'https://content.dropboxapi.com/2';
  }

  /**
   * Get OAuth2 authorization URL with PKCE
   * @param {string} redirectUri - Redirect URI after authorization
   * @returns {string} Authorization URL
   */
  async getAuthUrl(redirectUri) {
    // Generate PKCE code verifier and challenge
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
    // Store code verifier for token exchange
    localStorage.setItem('dropbox_pkce_verifier', codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      token_access_type: 'offline',
      scope: 'files.content.write files.content.read',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token using PKCE
   * @param {string} code - Authorization code
   * @param {string} redirectUri - Redirect URI
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(code, redirectUri) {
    const codeVerifier = localStorage.getItem('dropbox_pkce_verifier');
    if (!codeVerifier) {
      throw new Error('PKCE code verifier not found');
    }

    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
        code_verifier: codeVerifier
      })
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const errData = await response.json();
        errorDetail = errData.error_description || errData.error || response.statusText;
      } catch (e) {}
      throw new Error(`Token exchange failed: ${errorDetail}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this._refreshToken = data.refresh_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

    // Clear code verifier after use
    localStorage.removeItem('dropbox_pkce_verifier');

    return data;
  }

  /**
   * Refresh access token (PKCE - no client_secret needed)
   * @returns {Promise<Object>} New token response
   */
  async refreshToken() {
    if (!this._refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this._refreshToken,
        client_id: this.config.clientId
      })
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const errData = await response.json();
        errorDetail = errData.error_description || errData.error || response.statusText;
      } catch (e) {}
      throw new Error(`Token refresh failed: ${errorDetail}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

    return data;
  }

  /**
   * Generate PKCE code verifier
   * @returns {string} Random code verifier
   */
  generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate PKCE code challenge from verifier
   * @param {string} verifier - Code verifier
   * @returns {Promise<string>} Code challenge
   */
  async generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Upload file to Dropbox
   * @param {string} path - Destination path
   * @param {Blob|File} file - File to upload
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Upload response
   */
  async uploadFile(path, file, onProgress) {
    const response = await fetch(`${this.contentBaseUrl}/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: path,
          mode: 'overwrite',
          autorename: false
        }),
        'Content-Type': 'application/octet-stream'
      },
      body: file
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const errData = await response.json();
        errorDetail = errData.error_summary || errData.error || response.statusText;
      } catch (e) {}
      throw new Error(`Upload failed: ${errorDetail}`);
    }

    return await response.json();
  }

  /**
   * Download file from Dropbox
   * @param {string} path - File path
   * @returns {Promise<Blob>} File content
   */
  async downloadFile(path) {
    const response = await fetch(`${this.contentBaseUrl}/files/download`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: path })
      }
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const errData = await response.json();
        errorDetail = errData.error_summary || errData.error || response.statusText;
      } catch (e) {}
      throw new Error(`Download failed: ${errorDetail}`);
    }

    const blob = await response.blob();
    return blob;
  }

  /**
   * List files in a directory
   * @param {string} path - Directory path
   * @returns {Promise<Array>} List of files
   */
  async listFiles(path = '') {
    const response = await this.authenticatedRequest(`${this.apiBaseUrl}/files/list_folder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: path })
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const errData = await response.json();
        errorDetail = errData.error_summary || errData.error || response.statusText;
      } catch (e) {}
      throw new Error(`List files failed: ${errorDetail}`);
    }

    const data = await response.json();
    return data.entries;
  }

  /**
   * Delete file from Dropbox
   * @param {string} path - File path
   * @returns {Promise<void>}
   */
  async deleteFile(path) {
    const response = await this.authenticatedRequest(`${this.apiBaseUrl}/files/delete_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: path })
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.statusText}`);
    }
  }

  /**
   * Get file metadata
   * @param {string} path - File path
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(path) {
    const response = await this.authenticatedRequest(`${this.apiBaseUrl}/files/get_metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: path })
    });

    if (!response.ok) {
      throw new Error(`Get metadata failed: ${response.statusText}`);
    }

    return await response.json();
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DropboxProvider;
}
