const workspaceService = require('./workspace');

// What a group user may do (req.user from auth.requireLogin): read the
// configuration and the lists (filtered to their groups in the routes), and a
// few actions on projects of their groups. Everything else is admin-only.
// Projects of other groups answer 404, so their existence does not leak.

const OPEN_ROUTES = [
  ['GET', /^\/config$/],
  ['GET', /^\/projects\/?$/],
  ['GET', /^\/projects\/groups$/]
];

const PROJECT_ROUTES = [
  ['GET', /^\/projects\/([^/]+)$/],
  ['PUT', /^\/projects\/([^/]+)\/name$/],
  ['POST', /^\/projects\/([^/]+)\/(?:start|stop)$/],
  ['GET', /^\/projects\/([^/]+)\/notes$/],
  ['PUT', /^\/projects\/([^/]+)\/notes$/],
  ['GET', /^\/projects\/([^/]+)\/disk-usage$/],
  // Set, change or remove the workspace password (checks currentPassword)
  ['PUT', /^\/projects\/([^/]+)\/password$/]
];

function inUserGroups(user, project) {
  return !!project && user.groups.includes(project.group || 'Uncategorized');
}

function restrictGroupUsers(req, res, next) {
  // No user: public paths (health, login, workshop) - requireLogin decided
  if (!req.user || req.user.role !== 'group') return next();
  if (OPEN_ROUTES.some(([method, re]) => method === req.method && re.test(req.path))) return next();
  for (const [method, re] of PROJECT_ROUTES) {
    const match = method === req.method && re.exec(req.path);
    if (!match) continue;
    if (inUserGroups(req.user, workspaceService.projects.get(match[1]))) return next();
    return res.status(404).json({ error: 'Project not found', message: 'Project not found' });
  }
  return res.status(403).json({ error: 'Not allowed for this account', code: 'FORBIDDEN_FOR_ROLE' });
}

// Lists for a group user contain only the projects of their groups
function visibleProjects(user, projects) {
  if (!user || user.role !== 'group') return projects;
  return projects.filter(p => inUserGroups(user, p));
}

module.exports = { restrictGroupUsers, visibleProjects, inUserGroups };
