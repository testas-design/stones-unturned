// Minimal GitHub "contents" API client. Works in browsers and Node 18+.

export class ConflictError extends Error {}
export class AuthError extends Error {}
export class NetworkError extends Error {}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  constructor({ owner, repo, token, branch = 'main', apiBase = 'https://api.github.com' }) {
    Object.assign(this, { owner, repo, token, branch, apiBase: apiBase.replace(/\/$/, '') });
  }
  url(path = '') {
    return `${this.apiBase}/repos/${this.owner}/${this.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  async req(url, opts = {}, accept = 'application/vnd.github+json') {
    let res;
    try {
      res = await fetch(url, {
        cache: 'no-store',
        ...opts,
        headers: { Accept: accept, Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
      });
    } catch (e) {
      throw new NetworkError(e.message || 'Network error');
    }
    if (res.status === 401 || res.status === 403) {
      const body = await res.text();
      if (res.status === 403 && /rate limit/i.test(body)) throw new NetworkError('GitHub rate limit, try again soon');
      throw new AuthError(res.status === 401 ? 'Token rejected by GitHub' : 'Token lacks access to this repo');
    }
    return res;
  }
  async checkAccess() {
    const res = await this.req(`${this.apiBase}/repos/${this.owner}/${this.repo}`);
    if (res.status === 404) throw new AuthError('Repo not found (or the token cannot see it)');
    if (!res.ok) throw new NetworkError(`GitHub said ${res.status}`);
    const info = await res.json();
    if (info.permissions && !info.permissions.push) throw new AuthError('Token can read but not write this repo');
    return info;
  }
  /** Root listing: { path: sha } for every file at the repo root. */
  async listRoot() {
    const res = await this.req(`${this.url('')}?ref=${encodeURIComponent(this.branch)}`);
    if (!res.ok) throw new NetworkError(`GitHub said ${res.status}`);
    const out = {};
    for (const f of await res.json()) if (f.type === 'file') out[f.path] = f.sha;
    return out;
  }
  /** Returns { text, sha } or { text: null, sha: null } if the file does not exist. */
  async getFile(path) {
    const res = await this.req(`${this.url(path)}?ref=${encodeURIComponent(this.branch)}&t=${Date.now()}`);
    if (res.status === 404) return { text: null, sha: null };
    if (!res.ok) throw new NetworkError(`GitHub said ${res.status} for ${path}`);
    const j = await res.json();
    if (j.encoding === 'base64' && j.content) return { text: b64decode(j.content), sha: j.sha };
    // Files over 1 MB come without content: fetch them raw.
    const raw = await this.req(`${this.url(path)}?ref=${encodeURIComponent(this.branch)}&t=${Date.now()}`, {}, 'application/vnd.github.raw+json');
    if (!raw.ok) throw new NetworkError(`GitHub said ${raw.status} for ${path}`);
    return { text: await raw.text(), sha: j.sha };
  }
  /** Writes a file; returns the new sha. Throws ConflictError if `sha` is stale. */
  async putFile(path, text, sha, message) {
    const body = { message, content: b64encode(text), branch: this.branch };
    if (sha) body.sha = sha;
    const res = await this.req(this.url(path), { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    if (res.status === 409 || res.status === 422) throw new ConflictError(`${path} changed on GitHub`);
    if (!res.ok) throw new NetworkError(`GitHub said ${res.status} saving ${path}`);
    const j = await res.json();
    return j.content.sha;
  }
}
