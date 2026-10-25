const express = require('express');
const users = require('../services/users');

// Group users (admin only: access.js lets group users nowhere near this)
const router = express.Router();

function sendError(res, error) {
  res.status(error.status || 500).json({ error: error.message });
}

router.get('/', (req, res) => {
  res.json({ success: true, users: users.list() });
});

router.post('/', async (req, res) => {
  try {
    const { username, password, groups } = req.body || {};
    res.status(201).json({ success: true, user: await users.create({ username, password, groups }) });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { groups, password } = req.body || {};
    res.json({ success: true, user: await users.update(req.params.id, { groups, password }) });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await users.remove(req.params.id);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
