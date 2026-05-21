/**
 * OneDrive Cloud Storage Provider
 * Implements Microsoft Graph API for OneDrive file upload/download
 * Uses PKCE flow for secure authentication without client_secret
 */

class OneDriveProvider extends CloudStorageProvider {
  constructor(config) {
    super(config);
    this.apiBaseUrl = 'https://graph.microsoft.com/v1.0/me/drive';
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
    localStorage.setItem('onedrive_pkce_verifier', codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'Files.ReadWrite.All offline_access',
      response_mode: 'query',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token using PKCE
   * @param {string} code - Authorization code
   * @param {string} redirectUri - Redirect URI
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(code, redirectUri) {
    const codeVerifier = localStorage.getItem('onedrive_pkce_verifier');
    if (!codeVerifier) {
      throw new Error('PKCE code verifier not found');
    }

    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this._refreshToken = data.refresh_token;
    this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

    // Clear code verifier after use
    localStorage.removeItem('onedrive_pkce_verifier');

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

    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
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
      throw new Error(`Token refresh failed: ${response.statusText}`);
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
   * Upload file to OneDrive
   * @param {string} path - Destination path
   * @param {Blob|File} file - File to upload
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Upload response
   */
  async uploadFile(path, file, onProgress) {
    // For small files (< 4MB), use simple upload
    if (file.size < 4 * 1024 * 1024) {
      const response = await this.authenticatedRequest(`${this.apiBaseUrl}/root:/${encodeURIComponent(path)}:/content`, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      return await response.json();
    }

    // For large files, use upload session
    const sessionResponse = await this.authenticatedRequest(
      `${this.apiBaseUrl}/root:/${encodeURIComponent(path)}:/createUploadSession`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'replace'
          }
        })
      }
    );

    if (!sessionResponse.ok) {
      throw new Error(`Upload session creation failed: ${sessionResponse.statusText}`);
    }

    const session = await sessionResponse.json();
    return await this.uploadInChunks(session.uploadUrl, file, onProgress);
  }

  /**
   * Upload file in chunks for large files
   * @param {string} uploadUrl - Upload session URL
   * @param {Blob|File} file - File to upload
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Upload response
   */
  async uploadInChunks(uploadUrl, file, onProgress) {
    const fileSize = file.size;
    const chunkSize = 320 * 1024 * 1024; // 320MB max chunk size
    let uploadedBytes = 0;

    while (uploadedBytes < fileSize) {
      const end = Math.min(uploadedBytes + chunkSize, fileSize);
      const chunk = file.slice(uploadedBytes, end);

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': (end - uploadedBytes).toString(),
          'Content-Range': `bytes ${uploadedBytes}-${end - 1}/${fileSize}`
        },
        body: chunk
      });

      if (!response.ok) {
        throw new Error(`Chunk upload failed: ${response.statusText}`);
      }

      uploadedBytes = end;

      if (onProgress) {
        onProgress((uploadedBytes / fileSize) * 100);
      }
    }

    // Finalize upload
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${fileSize}`
      }
    });

    if (!response.ok) {
      throw new Error(`Upload finalization failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Download file from OneDrive
   * @param {string} path - File path
   * @returns {Promise<Blob>} File content
   */
  async downloadFile(path) {
    const response = await this.authenticatedRequest(`${this.apiBaseUrl}/root:/${encodeURIComponent(path)}:/content`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
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
    const url = path 
      ? `${this.apiBaseUrl}/root:/${encodeURIComponent(path)}:/children`
      : `${this.apiBaseUrl}/root/children`;

    const response = await this.authenticatedRequest(url, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`List files failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.value || [];
  }

  /**
   * Delete file from OneDrive
   * @param {string} path - File path
   * @returns {Promise<void>}
   */
  async deleteFile(path) {
    const response = await this.authenticatedRequest(`${this.apiBaseUrl}/root:/${encodeURIComponent(path)}`, {
      method: 'DELETE'
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
    const response = await this.authenticatedRequest(`${this.apiBaseUrl}/root:/${encodeURIComponent(path)}`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Get metadata failed: ${response.statusText}`);
    }

    return await response.json();
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OneDriveProvider;
}
