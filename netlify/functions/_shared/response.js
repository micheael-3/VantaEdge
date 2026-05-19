function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extra.headers || {}) },
    multiValueHeaders: extra.multiValueHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function error(statusCode, message, extra = {}) {
  return json(statusCode, { error: message, ...extra });
}

function notFound() {
  return error(404, 'Not found');
}

function methodNotAllowed() {
  return error(405, 'Method not allowed');
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseRaw(event) {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function subPath(event, name) {
  const url = event.path || event.rawUrl || '';
  let idx = url.indexOf(`/.netlify/functions/${name}`);
  if (idx >= 0) return url.slice(idx + `/.netlify/functions/${name}`.length) || '/';
  idx = url.indexOf(`/api/${name}`);
  if (idx >= 0) return url.slice(idx + `/api/${name}`.length) || '/';
  return '/';
}

module.exports = { json, error, notFound, methodNotAllowed, parseBody, parseRaw, subPath };
