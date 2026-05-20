// Public lightweight status endpoint — drives the green/yellow/grey
// "Agent Active" dot in the navbar.
//
//   GET /api/agent/status

const { json, error, notFound, subPath } = require('./_shared/response');
const { buildAgentStatus } = require('./_shared/agent');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');
    const path = subPath(event, 'agent-status');
    if (path !== '/' && path !== '' && path !== '/status') return notFound();
    const status = await buildAgentStatus();
    return json(200, status);
  } catch (err) {
    console.error('agent-status handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
