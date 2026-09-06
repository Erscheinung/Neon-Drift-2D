// Serverless route for the optional Airtable leaderboard.
// All credentials are read from server-side environment variables.

const AIRTABLE_API_ROOT = 'https://api.airtable.com/v0';

function getConfig() {
  const { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = process.env;
  if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) return null;
  return { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID };
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function validScore(score) {
  return Number.isSafeInteger(score) && score >= 0 && score <= 1_000_000_000;
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'Method not allowed');
  }

  const config = getConfig();
  if (!config) return sendError(res, 500, 'Leaderboard is not configured');

  const airtableUrl = `${AIRTABLE_API_ROOT}/${encodeURIComponent(config.AIRTABLE_BASE_ID)}/${encodeURIComponent(config.AIRTABLE_TABLE_ID)}`;
  const headers = { Authorization: `Bearer ${config.AIRTABLE_PAT}` };

  try {
    if (req.method === 'GET') {
      const params = new URLSearchParams({
        'sort[0][field]': 'Score',
        'sort[0][direction]': 'desc',
        maxRecords: '10',
      });
      params.append('fields[]', 'Name');
      params.append('fields[]', 'Score');

      const response = await fetch(`${airtableUrl}?${params}`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('Airtable read failed', response.status);
        return sendError(res, 502, 'Leaderboard unavailable');
      }

      const records = Array.isArray(data.records)
        ? data.records
            .map(record => ({
              name: record.fields?.Name,
              score: record.fields?.Score,
            }))
            .filter(record => typeof record.name === 'string' && validScore(record.score))
        : [];
      return res.status(200).json({ records });
    }

    const body = parseBody(req.body);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 20) : '';
    const score = Number(body?.score);
    if (!name || !validScore(score)) return sendError(res, 400, 'Invalid score');

    const response = await fetch(airtableUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          Name: name,
          Score: score,
          Date: new Date().toISOString().slice(0, 10),
        },
      }),
    });
    if (!response.ok) {
      console.error('Airtable write failed', response.status);
      return sendError(res, 502, 'Could not save score');
    }
    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Leaderboard request failed', error);
    return sendError(res, 502, 'Leaderboard unavailable');
  }
}

module.exports = handler;
