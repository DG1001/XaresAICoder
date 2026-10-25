const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { writeJsonAtomic, readJson } = require('./persistence');

// Group users: dashboard logins that only see and manage the projects of
// their groups (sessions in auth.js, route allowlist in access.js). Kept in
// the data volume, so backup.sh covers them.

const USERS_FILE = path.join('/app', 'workspaces', 'group-users.json');
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
const GROUP_RE = /^[a-zA-Z0-9\s\-_]{1,50}$/;
// Compared against for unknown usernames, so a login takes the same time
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// Same rule for workspace passwords and user passwords
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (password.length > 50) {
    return 'Password must be less than 50 characters';
  }
  if (/[\x00-\x1f\x7f]/.test(password)) {
    return 'Password must not contain control characters';
  }
  return null;
}

function userError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

class UsersService {
  constructor() {
    this.users = new Map();
    this.ready = this.load().catch(err => console.error('Could not load group users:', err));
  }

  async load() {
    const data = await readJson(USERS_FILE);
    for (const user of (data && data.users) || []) this.users.set(user.id, user);
  }

  async save() {
    await writeJsonAtomic(USERS_FILE, { users: [...this.users.values()] });
  }

  serialize(user) {
    return { id: user.id, username: user.username, groups: user.groups, createdAt: user.createdAt };
  }

  list() {
    return [...this.users.values()].map(u => this.serialize(u))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  get(id) {
    return this.users.get(id) || null;
  }

  findByUsername(username) {
    const name = String(username || '').trim().toLowerCase();
    for (const user of this.users.values()) if (user.username === name) return user;
    return null;
  }

  normalizeGroups(groups) {
    if (!Array.isArray(groups)) throw userError('groups must be a list of group names');
    const names = [...new Set(groups.map(g => String(g).trim()))];
    for (const name of names) {
      if (!GROUP_RE.test(name)) throw userError(`Invalid group name: ${name}`);
    }
    return names;
  }

  async create({ username, password, groups }) {
    await this.ready;
    const name = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(name)) {
      throw userError('Username must be 2-40 characters: letters, digits, dots, hyphens, underscores');
    }
    if (name === 'admin') throw userError('The username "admin" is reserved');
    if (this.findByUsername(name)) throw userError('Username already exists', 409);
    const passwordError = validatePassword(password);
    if (passwordError) throw userError(passwordError);

    const user = {
      id: crypto.randomUUID(),
      username: name,
      passwordHash: await bcrypt.hash(password, 10),
      groups: this.normalizeGroups(groups || []),
      sessionVersion: 1,
      createdAt: new Date().toISOString()
    };
    this.users.set(user.id, user);
    await this.save();
    return this.serialize(user);
  }

  // A new password ends the user's sessions (sessionVersion is in the cookie)
  async update(id, { groups, password }) {
    await this.ready;
    const user = this.get(id);
    if (!user) throw userError('User not found', 404);
    if (groups !== undefined) user.groups = this.normalizeGroups(groups);
    if (password !== undefined) {
      const passwordError = validatePassword(password);
      if (passwordError) throw userError(passwordError);
      user.passwordHash = await bcrypt.hash(password, 10);
      user.sessionVersion++;
    }
    await this.save();
    return this.serialize(user);
  }

  async remove(id) {
    await this.ready;
    if (!this.users.delete(id)) throw userError('User not found', 404);
    await this.save();
  }

  async verifyLogin(username, password) {
    await this.ready;
    const user = this.findByUsername(username);
    const ok = await bcrypt.compare(String(password || ''), user ? user.passwordHash : DUMMY_HASH);
    return ok && user ? user : null;
  }

  // Group renamed or deleted in the dashboard: assignments follow
  async renameGroup(oldName, newName) {
    await this.ready;
    let changed = false;
    for (const user of this.users.values()) {
      if (!user.groups.includes(oldName)) continue;
      user.groups = [...new Set(user.groups.map(g => (g === oldName ? newName : g)))];
      changed = true;
    }
    if (changed) await this.save();
  }

  async removeGroup(name) {
    await this.ready;
    let changed = false;
    for (const user of this.users.values()) {
      if (!user.groups.includes(name)) continue;
      user.groups = user.groups.filter(g => g !== name);
      changed = true;
    }
    if (changed) await this.save();
  }
}

const usersService = new UsersService();
usersService.validatePassword = validatePassword;
module.exports = usersService;
