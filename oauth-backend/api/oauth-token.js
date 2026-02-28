/**
 * Notion OAuth token exchange proxy
 *
 * client_secret을 프론트엔드에 노출하지 않도록 서버에서 교환합니다.
 *
 * 환경 변수 (Vercel 프로젝트 Settings > Environment Variables):
 *   NOTION_CLIENT_ID     - Notion OAuth 앱의 client_id
 *   NOTION_CLIENT_SECRET - Notion OAuth 앱의 client_secret
 *   EXTENSION_ORIGIN     - 허용할 크롬 확장 origin (선택, 없으면 any)
 */
export default async function handler(req, res) {
  // CORS: 크롬 확장에서의 요청 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, redirect_uri } = req.body ?? {};
  if (!code || !redirect_uri) {
    return res.status(400).json({ error: 'Missing code or redirect_uri' });
  }

  const clientId     = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Server OAuth credentials not configured' });
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let notionRes;
  try {
    notionRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({
        grant_type:   'authorization_code',
        code,
        redirect_uri,
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Notion API', detail: err.message });
  }

  const data = await notionRes.json();

  if (!notionRes.ok) {
    return res.status(notionRes.status).json(data);
  }

  // access_token만 반환 (불필요한 정보 노출 방지)
  return res.status(200).json({ access_token: data.access_token });
}
