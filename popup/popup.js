// ─── OAuth 설정 (Notion Developer Portal에서 발급) ─────────────────────────────
const OAUTH_CLIENT_ID     = '315d872b-594c-81d6-a8ee-0037df2069f3';
// client_secret은 Vercel 백엔드(oauth-backend/)에서 환경변수로 관리합니다.
// Vercel 배포 후 아래 URL을 실제 배포 URL로 교체하세요.
const OAUTH_TOKEN_ENDPOINT = 'https://padlet-to-notion-ext.vercel.app/api/oauth-token';

// ─── SVG 아이콘 ───────────────────────────────────────────────────────────────
const ICONS = {
  db: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="4.5" rx="4.5" ry="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 4.5V8C3.5 8.99 5.52 9.8 8 9.8C10.48 9.8 12.5 8.99 12.5 8V4.5" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 8V11.5C3.5 12.49 5.52 13.3 8 13.3C10.48 13.3 12.5 12.49 12.5 11.5V8" stroke="currentColor" stroke-width="1.3"/></svg>`,
  pencil: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5L11.5 4.5L4.5 11.5H2.5V9.5L9.5 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 3.5H11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4.5 3.5V2.5C4.5 2.22 4.72 2 5 2H9C9.28 2 9.5 2.22 9.5 2.5V3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 3.5L10 11.5C10 11.78 9.78 12 9.5 12H4.5C4.22 12 4 11.78 4 11.5L3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  export: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 13V5M7 8L10 5L13 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14V16H16V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  spinner: `<svg class="spin" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="33 11"/></svg>`,
  check: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 10.5L8.5 12.5L13.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  error: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 7V10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="13" r="0.8" fill="currentColor"/></svg>`,
};

// ─── 전역 상태 ────────────────────────────────────────────────────────────────
let isSaving = false;
let currentConnection = null;  // saveView 진입 시 설정
let pendingConnection = null;  // onboarding OAuth 완료 후 이름 입력 대기 중

// ─── Storage ─────────────────────────────────────────────────────────────────
async function loadConnections() {
  const data = await new Promise(resolve =>
    chrome.storage.local.get(
      ['connections', 'notionToken', 'padletDbId', 'postDbId', 'padletProps', 'postProps'],
      resolve
    )
  );

  // ── 구 포맷 마이그레이션 ──────────────────────────────────────────────────
  if (!data.connections && data.notionToken) {
    const migrated = [{
      id:           crypto.randomUUID(),
      name:         '기본 연결',
      notionToken:  data.notionToken,
      padletDbId:   data.padletDbId,
      postDbId:     data.postDbId,
      padletProps:  data.padletProps,
      postProps:    data.postProps,
    }];
    await chrome.storage.local.set({ connections: migrated });
    await chrome.storage.local.remove(
      ['notionToken', 'padletDbId', 'postDbId', 'padletProps', 'postProps']
    );
    return migrated;
  }

  return data.connections || [];
}

function saveConnections(connections) {
  return new Promise(resolve => chrome.storage.local.set({ connections }, resolve));
}

function normalizeDbId(input) {
  if (!input) return '';
  const match = input.trim().match(/([0-9a-f]{32})/i);
  return match ? match[1] : input.trim().replace(/-/g, '');
}

// ─── Notion API ───────────────────────────────────────────────────────────────
async function notionRequest(method, path, body, token) {
  const res = await fetch(`https://api.notion.com${path}`, {
    method,
    headers: {
      'Authorization':  `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type':   'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Notion API ${res.status}`);
  return data;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────
function startOAuthFlow() {
  const redirectUri = chrome.identity.getRedirectURL('notion');
  const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
  authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('owner', 'user');
  authUrl.searchParams.set('redirect_uri', redirectUri);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'OAuth가 취소되었습니다'));
          return;
        }
        const code = new URL(redirectUrl).searchParams.get('code');
        if (!code) reject(new Error('인증 코드를 받지 못했습니다'));
        else resolve({ code, redirectUri });
      }
    );
  });
}

async function exchangeCodeForToken(code, redirectUri) {
  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'OAuth 토큰 교환 실패');
  return {
    token:               data.access_token,
    workspaceName:       data.workspace_name,
    duplicatedTemplateId: data.duplicated_template_id ?? null,
  };
}

// ─── 템플릿 복사본에서 DB 자동 매핑 ──────────────────────────────────────────

// 후보 이름 목록에서 첫 번째로 매칭되는 속성 ID 반환 (대소문자 무시, 부분 일치 포함)
// 우선순위: 완전 일치 → 속성명이 후보를 포함 → 후보가 속성명을 포함
function findPropId(props, ...candidates) {
  const lower = candidates.map(c => c.toLowerCase());
  const keys = Object.keys(props);

  // 1차: 완전 일치
  let key = keys.find(k => lower.includes(k.toLowerCase()));
  if (key) return props[key].id;

  // 2차: 속성명이 후보를 포함 (e.g. "패들렛 생성 일시".includes("생성 일시"))
  key = keys.find(k => { const kl = k.toLowerCase(); return lower.some(c => kl.includes(c)); });
  if (key) return props[key].id;

  // 3차: 후보가 속성명을 포함 (e.g. "패들렛 생성 일시".includes("일시"))
  key = keys.find(k => { const kl = k.toLowerCase(); return lower.some(c => c.includes(kl)); });
  return key ? props[key].id : null;
}

// title 타입 속성 ID 반환
function findTitlePropId(props) {
  const key = Object.keys(props).find(k => props[k].type === 'title');
  return key ? props[key].id : 'title';
}

// relation 타입 속성 ID 반환 (첫 번째)
function findRelationPropId(props) {
  const key = Object.keys(props).find(k => props[k].type === 'relation');
  return key ? props[key].id : null;
}

// ─── 템플릿 속성 ID 하드코딩 (실험: 복제 시 속성 ID 보존 여부 검증) ──────────
// 원본 DB에서 추출: 패들렛 DB(314dd1dc...) / 포스트 DB(45224ebc...)
const TEMPLATE_PADLET_PROPS = {
  title:     'title',
  boardId:   '%60A%7Cu',
  url:       'QH%5Ep',
  creator:   'HaT%7D',
  createdAt: 'u%5E%60D',
  editedAt:  'RFOH',
};
const TEMPLATE_POST_PROPS = {
  title:     'title',
  postId:    'VTa%3D',
  section:   'WXol',
  body:      'Wtef',
  link:      '%5E%5Chg',
  postUrl:   'khko',
  image:     'nfwo',
  author:    'S%60Tc',
  createdAt: 'I%5DZX',
  padlet:    'VkJQ',
};

async function connectFromTemplate(token, templatePageId, onStep) {
  onStep('템플릿에서 DB 탐색 중...');

  // 복제 직후 copy_indicator 블록이 일시적으로 존재해 blocks API가 실패할 수 있음
  // → 에러 메시지에 copy_indicator가 포함되면 최대 3회 재시도 (1.5s 간격)
  let blocks;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      blocks = await notionRequest('GET', `/v1/blocks/${templatePageId}/children`, null, token);
      break;
    } catch (e) {
      if (attempt < 2 && e.message?.includes('copy_indicator')) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }

  const dbBlocks = blocks.results.filter(b => b.type === 'child_database');

  if (dbBlocks.length < 2) {
    throw new Error(
      `템플릿에서 DB를 찾지 못했습니다 (발견: ${dbBlocks.length}개).\n` +
      '템플릿 페이지에 패들렛 DB와 포스트 DB가 있어야 합니다.'
    );
  }

  const getTitle    = b => (b.child_database?.title ?? '').toLowerCase();
  const padletBlock = dbBlocks.find(b => { const t = getTitle(b); return t.includes('패들렛') || t.includes('padlet'); });
  const postBlock   = dbBlocks.find(b => { const t = getTitle(b); return t.includes('포스트') || t.includes('post'); });

  const found = dbBlocks.map(b => `"${b.child_database?.title ?? '?'}"`).join(', ');
  if (!padletBlock) throw new Error(`패들렛 DB를 찾을 수 없습니다.\n발견된 DB: ${found}`);
  if (!postBlock)   throw new Error(`포스트 DB를 찾을 수 없습니다.\n발견된 DB: ${found}`);

  return {
    padletDbId:  padletBlock.id.replace(/-/g, ''),
    postDbId:    postBlock.id.replace(/-/g, ''),
    padletProps: TEMPLATE_PADLET_PROPS,
    postProps:   TEMPLATE_POST_PROPS,
  };
}
// ─── DB 자동 생성 ─────────────────────────────────────────────────────────────
async function createDatabases(token, onStep) {
  onStep('워크스페이스에 페이지 생성 중...');
  const page = await notionRequest('POST', '/v1/pages', {
    parent: { type: 'workspace', workspace: true },
    properties: { title: { title: [{ text: { content: 'Padlet → Notion' } }] } },
  }, token);

  onStep('패들렛 DB 생성 중...');
  const padletDb = await notionRequest('POST', '/v1/databases', {
    parent: { type: 'page_id', page_id: page.id },
    is_inline: true,
    title: [{ text: { content: '패들렛' } }],
    properties: {
      '이름':           { title: {} },
      '패들렛 ID':      { rich_text: {} },
      '패들렛 URL':     { url: {} },
      '생성자':         { rich_text: {} },
      '생성 일시':      { date: {} },
      '최종 편집 일시': { date: {} },
    },
  }, token);

  onStep('포스트 DB 생성 중...');
  const postDb = await notionRequest('POST', '/v1/databases', {
    parent: { type: 'page_id', page_id: page.id },
    is_inline: true,
    title: [{ text: { content: '포스트' } }],
    properties: {
      '이름':       { title: {} },
      '섹션':       { select: { options: [] } },
      '본문':       { rich_text: {} },
      '링크':       { url: {} },
      '이미지':     { files: {} },
      '포스트 URL': { url: {} },
      '작성자':     { rich_text: {} },
      '포스트 ID':  { rich_text: {} },
      '생성 일시':  { date: {} },
      '패들렛':     { relation: { database_id: padletDb.id, type: 'single_property', single_property: {} } },
    },
  }, token);

  const pp = padletDb.properties;
  const qp = postDb.properties;

  return {
    padletDbId: padletDb.id.replace(/-/g, ''),
    postDbId:   postDb.id.replace(/-/g, ''),
    padletProps: {
      title:     pp['이름'].id,
      boardId:   pp['패들렛 ID'].id,
      url:       pp['패들렛 URL'].id,
      creator:   pp['생성자'].id,
      createdAt: pp['생성 일시'].id,
      editedAt:  pp['최종 편집 일시'].id,
    },
    postProps: {
      title:     qp['이름'].id,
      section:   qp['섹션'].id,
      body:      qp['본문'].id,
      link:      qp['링크'].id,
      image:     qp['이미지'].id,
      postUrl:   qp['포스트 URL'].id,
      author:    qp['작성자'].id,
      postId:    qp['포스트 ID'].id,
      createdAt: qp['생성 일시'].id,
      padlet:    qp['패들렛'].id,
    },
  };
}

// ─── Properties 빌더 ─────────────────────────────────────────────────────────
function truncate(str, max = 2000) {
  return str && str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function buildPadletProps(board, p) {
  const props = {};
  // null인 속성 ID는 건너뜀
  if (p.title)     props[p.title]     = { title:     [{ text: { content: board.boardTitle || '(제목 없음)' } }] };
  if (p.boardId)   props[p.boardId]   = { rich_text: [{ text: { content: board.boardId || '' } }] };
  if (p.url)       props[p.url]       = board.boardUrl     ? { url: board.boardUrl }                                      : { url: null };
  if (p.creator)   props[p.creator]   = board.boardCreator ? { rich_text: [{ text: { content: board.boardCreator } }] }  : { rich_text: [] };
  if (p.createdAt) props[p.createdAt] = board.dateCreated  ? { date: { start: board.dateCreated } }                       : { date: null };
  if (p.editedAt)  props[p.editedAt]  = board.dateModified ? { date: { start: board.dateModified } }                      : { date: null };
  return props;
}

function buildPostProps(post, padletPageId, p) {
  const props = {};
  if (p.title)     props[p.title]     = { title:     [{ text: { content: post.title || '(제목 없음)' } }] };
  if (p.section)   props[p.section]   = post.section  ? { select:    { name: post.section } }                                                   : { select: null };
  if (p.body)      props[p.body]      = post.body     ? { rich_text: [{ text: { content: truncate(post.body) } }] }                             : { rich_text: [] };
  if (p.link)      props[p.link]      = post.link     ? { url: post.link }                                                                       : { url: null };
  if (p.image)     props[p.image]     = post.imageUrl ? { files: [{ type: 'external', name: 'image', external: { url: post.imageUrl } }] }      : { files: [] };
  if (p.postUrl)   props[p.postUrl]   = post.postUrl  ? { url: post.postUrl }                                                                    : { url: null };
  if (p.author)    props[p.author]    = post.author   ? { rich_text: [{ text: { content: post.author } }] }                                     : { rich_text: [] };
  if (p.postId)    props[p.postId]    = post.postId   ? { rich_text: [{ text: { content: post.postId } }] }                                     : { rich_text: [] };
  if (p.createdAt) props[p.createdAt] = post.postDate ? { date: { start: post.postDate } }                                                       : { date: null };
  if (p.padlet)    props[p.padlet]    = { relation: [{ id: padletPageId }] };
  return props;
}

// ─── Upsert / Archive ─────────────────────────────────────────────────────────
async function upsertPadletPage(board, conn) {
  const data = await notionRequest('POST', `/v1/databases/${conn.padletDbId}/query`, {
    filter: { property: conn.padletProps.boardId, rich_text: { equals: board.boardId } },
  }, conn.notionToken);

  const props = buildPadletProps(board, conn.padletProps);
  const existing = data.results[0];

  if (existing) {
    await notionRequest('PATCH', `/v1/pages/${existing.id}`, { properties: props }, conn.notionToken);
    return { id: existing.id, action: 'updated' };
  }
  const res = await notionRequest('POST', '/v1/pages', {
    parent: { database_id: conn.padletDbId },
    properties: props,
  }, conn.notionToken);
  return { id: res.id, action: 'created' };
}

async function upsertPostPage(post, padletPageId, conn) {
  // postId가 없으면 중복 체크 불가 → 항상 신규 생성
  let existing;
  if (post.postId) {
    const data = await notionRequest('POST', `/v1/databases/${conn.postDbId}/query`, {
      filter: { property: conn.postProps.postId, rich_text: { equals: post.postId } },
    }, conn.notionToken);
    existing = data.results[0];
  }

  const props = buildPostProps(post, padletPageId, conn.postProps);

  if (existing) {
    await notionRequest('PATCH', `/v1/pages/${existing.id}`, { properties: props }, conn.notionToken);
    return { id: existing.id, action: 'updated' };
  }
  const res = await notionRequest('POST', '/v1/pages', {
    parent: { database_id: conn.postDbId },
    properties: props,
  }, conn.notionToken);
  return { id: res.id, action: 'created' };
}

async function archiveDeletedPosts(padletPageId, upsertedPageIds, conn) {
  const allPosts = [];
  let cursor;
  do {
    const data = await notionRequest('POST', `/v1/databases/${conn.postDbId}/query`, {
      filter: { property: conn.postProps.padlet, relation: { contains: padletPageId } },
      ...(cursor ? { start_cursor: cursor } : {}),
    }, conn.notionToken);
    allPosts.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  const toArchive = allPosts.filter(p => !upsertedPageIds.has(p.id));
  await Promise.all(
    toArchive.map(page =>
      notionRequest('PATCH', `/v1/pages/${page.id}`, { archived: true }, conn.notionToken)
    )
  );
  return toArchive.length;
}

// ─── UI 헬퍼 ─────────────────────────────────────────────────────────────────
function setStatus(type, icon, text) {
  document.getElementById('status').className = `status ${type}`;
  document.getElementById('statusIcon').innerHTML = icon;
  document.getElementById('statusText').textContent = text;
}

function setProgress(pct, text) {
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressText').textContent = text;
}

function showView(id) {
  ['listView', 'saveView', 'settingsView', 'onboardingView'].forEach(v =>
    document.getElementById(v).classList.toggle('hidden', v !== id)
  );
  // onboarding 화면을 (재)표시할 때는 초기 상태로 복원
  if (id === 'onboardingView') {
    pendingConnection = null;
    const oauthBtn = document.getElementById('oauthStartBtn');
    oauthBtn.disabled    = false;
    oauthBtn.textContent = 'Notion 계정 연결';
    oauthBtn.classList.remove('hidden');
    document.getElementById('goToSettingsBtn').classList.remove('hidden');
    document.getElementById('onboardingNameSection').classList.add('hidden');
    document.getElementById('onboardingNameInput').value = '';
    document.getElementById('onboardingError').classList.add('hidden');
  }
}

// ─── 연결 목록 렌더링 ─────────────────────────────────────────────────────────
function renderConnectionList(connections) {
  const list = document.getElementById('connectionList');
  list.innerHTML = '';

  connections.forEach(conn => {
    const item = document.createElement('div');
    item.className = 'connection-item';

    const iconEl     = document.createElement('span');
    iconEl.className = 'connection-item-icon';
    iconEl.innerHTML = ICONS.db;

    const nameEl     = document.createElement('span');
    nameEl.className = 'connection-item-name';
    nameEl.textContent = conn.name;

    const renameBtn     = document.createElement('button');
    renameBtn.className = 'connection-rename-btn';
    renameBtn.title     = '이름 변경';
    renameBtn.innerHTML = ICONS.pencil;

    const deleteBtn     = document.createElement('button');
    deleteBtn.className = 'connection-delete-btn';
    deleteBtn.title     = '삭제';
    deleteBtn.innerHTML = ICONS.trash;

    item.append(iconEl, nameEl, renameBtn, deleteBtn);

    // 항목 클릭 → saveView (버튼 영역·편집 중 제외)
    item.addEventListener('click', (e) => {
      if (e.target.closest('.connection-rename-btn, .connection-delete-btn')) return;
      if (item.querySelector('.connection-name-input')) return; // 편집 중
      showSaveView(conn);
    });

    // 이름 변경 버튼
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineRename(item, nameEl, conn.id);
    });

    // 삭제 버튼
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.confirm(`"${conn.name}" 연결을 삭제하시겠습니까?`)) return;
      const all     = await loadConnections();
      const updated = all.filter(c => c.id !== conn.id);
      await saveConnections(updated);
      if (updated.length === 0) showView('onboardingView');
      else renderConnectionList(updated);
    });

    list.appendChild(item);
  });
}

// ─── 인라인 이름 편집 ─────────────────────────────────────────────────────────
function startInlineRename(item, nameEl, connId) {
  if (item.querySelector('.connection-name-input')) return; // 이미 편집 중

  const originalName = nameEl.textContent;
  const input        = document.createElement('input');
  input.type         = 'text';
  input.className    = 'connection-name-input';
  input.value        = originalName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  async function commit() {
    if (committed) return;
    committed = true;

    const newName = input.value.trim() || originalName;
    const all     = await loadConnections();
    const updated = all.map(c => c.id === connId ? { ...c, name: newName } : c);
    await saveConnections(updated);

    // currentConnection도 최신화
    if (currentConnection?.id === connId) currentConnection = updated.find(c => c.id === connId);

    // 목록 전체 재렌더 (클로저 내 conn 객체 갱신)
    renderConnectionList(updated);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = originalName; input.blur(); }
  });
}

// ─── saveView 진입 ────────────────────────────────────────────────────────────
function showSaveView(conn) {
  currentConnection = conn;

  // header 업데이트
  document.getElementById('saveViewTitle').textContent = conn.name;

  // 저장 버튼 초기 상태 복원
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.textContent = '확인';
  saveBtn.dataset.done = '';
  saveBtn.classList.remove('btn-done');
  saveBtn.disabled = false;

  // 상태 초기화
  setStatus('idle', ICONS.export, '패들렛을 노션으로 내보내시겠습니까?');
  document.getElementById('progress').classList.add('hidden');
  document.getElementById('progressFill').style.width = '0%';

  showView('saveView');
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const connections = await loadConnections();

  if (connections.length === 0) {
    showView('onboardingView');
    return;
  }

  renderConnectionList(connections);
  showView('listView');

  // 패들렛 페이지 여부 미리 확인 (목록에서도 알림)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url?.includes('padlet.com')) {
    document.getElementById('notPadletHint').classList.remove('hidden');
  }
});

// ─── 연결 추가 버튼 (listView) ───────────────────────────────────────────────
document.getElementById('addConnectionBtn').addEventListener('click', () => {
  // 설정 화면을 "추가 모드"로 열기 (필드 초기화)
  document.getElementById('authToken').checked   = true;
  document.getElementById('modeConnect').checked = true;
  document.getElementById('settingsError').classList.add('hidden');
  document.getElementById('connNameInput').value  = '';
  document.getElementById('tokenInput').value     = '';
  document.getElementById('padletDbInput').value  = '';
  document.getElementById('postDbInput').value    = '';
  updateSettingsUI();
  showView('settingsView');
});

// ─── saveView: 뒤로가기 ──────────────────────────────────────────────────────
document.getElementById('backBtn').addEventListener('click', async () => {
  const connections = await loadConnections();
  renderConnectionList(connections);
  showView('listView');
});

// ─── saveView: 연결 이름 변경 ────────────────────────────────────────────────
document.getElementById('renameConnBtn').addEventListener('click', () => {
  if (!currentConnection) return;

  const titleEl    = document.getElementById('saveViewTitle');
  const originalName = currentConnection.name;

  const input   = document.createElement('input');
  input.type    = 'text';
  input.id      = 'saveViewTitleInput';
  input.value   = originalName;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  async function commit() {
    if (committed) return;
    committed = true;

    const newName = input.value.trim() || originalName;

    // span 복원
    const newTitle = document.createElement('span');
    newTitle.id    = 'saveViewTitle';
    newTitle.textContent = newName;
    input.replaceWith(newTitle);

    // 저장
    const all     = await loadConnections();
    const updated = all.map(c => c.id === currentConnection.id ? { ...c, name: newName } : c);
    await saveConnections(updated);
    currentConnection = updated.find(c => c.id === currentConnection.id);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = originalName; input.blur(); }
  });
});

// ─── saveView: 현재 연결 삭제 ────────────────────────────────────────────────
document.getElementById('deleteConnBtn').addEventListener('click', async () => {
  if (!currentConnection) return;
  if (!window.confirm(`"${currentConnection.name}" 연결을 삭제하시겠습니까?`)) return;

  const all = await loadConnections();
  const updated = all.filter(c => c.id !== currentConnection.id);
  await saveConnections(updated);
  currentConnection = null;

  if (updated.length === 0) {
    showView('onboardingView');
  } else {
    renderConnectionList(updated);
    showView('listView');
  }
});

// ─── 저장 버튼 ────────────────────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  const saveBtn = document.getElementById('saveBtn');

  // 완료 상태: 팝업 닫기
  if (saveBtn.dataset.done === 'true') {
    window.close();
    return;
  }

  if (isSaving) return;
  isSaving = true;
  saveBtn.disabled = true;
  document.getElementById('progress').classList.remove('hidden');
  setStatus('running', ICONS.spinner, '작업 중...');

  try {
    const conn = currentConnection;
    if (!conn) throw new Error('연결 정보가 없습니다. 뒤로가기 후 다시 선택해주세요.');

    // 1. 패들렛 DOM 파싱
    setProgress(5, '패들렛 파싱 중...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'parsePadlet' });
    } catch {
      // 콘텐츠 스크립트 미주입 → 자동 새로고침 후 재시도
      setStatus('running', ICONS.spinner, '페이지 새로고침 중...');
      await chrome.tabs.reload(tab.id);
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
      await new Promise(r => setTimeout(r, 2500)); // 콘텐츠 스크립트 초기화 여유 (SPA 렌더 대기)
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'parsePadlet' });
      } catch {
        throw new Error('패들렛 페이지에서만 사용할 수 있습니다');
      }
    }
    if (!response?.success) throw new Error(response?.error || '파싱 실패');

    const { board, posts } = response.data;
    setProgress(15, `"${board.boardTitle}" — 포스트 ${posts.length}개`);

    // 2. 패들렛 upsert
    setProgress(20, '패들렛 저장 중...');
    const { id: padletPageId } = await upsertPadletPage(board, conn);

    // 3. 포스트 upsert — 5개씩 병렬 처리
    const BATCH = 5;
    const upsertedPageIds = new Set();
    let processed = 0;

    for (let i = 0; i < posts.length; i += BATCH) {
      const batch = posts.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(post => upsertPostPage(post, padletPageId, conn))
      );
      results.forEach(({ id }) => upsertedPageIds.add(id));
      processed += batch.length;
      const pct = 30 + Math.round((processed / posts.length) * 50);
      setProgress(pct, `포스트 저장 중... (${processed}/${posts.length})`);
    }

    // 4. 삭제된 포스트 아카이브
    setProgress(85, '삭제된 포스트 확인 중...');
    const archivedCount = await archiveDeletedPosts(padletPageId, upsertedPageIds, conn);

    setProgress(100, '완료!');
    const extra = archivedCount > 0 ? ` (${archivedCount}개 아카이브)` : '';
    setStatus('success', ICONS.check, `포스트 ${posts.length}개 저장 완료${extra} · 커스텀 필드 미지원`);

    // 완료 상태로 전환
    saveBtn.textContent = '완료';
    saveBtn.dataset.done = 'true';
    saveBtn.classList.add('btn-done');
  } catch (err) {
    setStatus('error', ICONS.error, err.message);
  } finally {
    isSaving = false;
    saveBtn.disabled = false;
    setTimeout(() => document.getElementById('progress').classList.add('hidden'), 2000);
  }
});

// ─── 설정 화면: radio 토글 ────────────────────────────────────────────────────
function updateSettingsUI() {
  const isOAuth   = document.getElementById('authOAuth').checked;
  const isConnect = document.getElementById('modeConnect').checked;

  document.getElementById('tokenFields').classList.toggle('hidden', isOAuth);
  document.getElementById('existingDbFields').classList.toggle('hidden', !isConnect);

  const createOption  = document.getElementById('modeCreate');
  const createLabel   = document.getElementById('createDbLabel');
  const oauthRequired = document.getElementById('oauthRequired');

  if (!isOAuth && createOption.checked) {
    document.getElementById('modeConnect').checked = true;
    document.getElementById('existingDbFields').classList.remove('hidden');
  }
  createLabel.classList.toggle('disabled', !isOAuth);
  oauthRequired.classList.toggle('hidden', isOAuth);

  const btn = document.getElementById('saveSettingsBtn');
  if (isOAuth) {
    btn.textContent = isConnect ? '계정 연결 및 DB 확인' : '계정 연결 및 DB 생성';
  } else {
    btn.textContent = '연결하기';
  }
}

document.querySelectorAll('input[name="authMode"], input[name="dbMode"]').forEach(radio => {
  radio.addEventListener('change', updateSettingsUI);
});

// ─── 설정: 취소 ───────────────────────────────────────────────────────────────
document.getElementById('cancelSettingsBtn').addEventListener('click', async () => {
  const connections = await loadConnections();
  if (connections.length > 0) {
    renderConnectionList(connections);
    showView('listView');
  } else {
    showView('onboardingView');
  }
});

// ─── 설정: 저장 (연결 추가) ───────────────────────────────────────────────────
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const isOAuth   = document.getElementById('authOAuth').checked;
  const isConnect = document.getElementById('modeConnect').checked;
  const errorEl   = document.getElementById('settingsError');
  const btn       = document.getElementById('saveSettingsBtn');

  errorEl.classList.add('hidden');
  btn.disabled = true;

  try {
    let token, workspaceName, duplicatedTemplateId;

    // ── 인증 ──────────────────────────────────────────────────
    if (isOAuth) {
      if (OAUTH_CLIENT_ID === 'YOUR_NOTION_CLIENT_ID') {
        throw new Error('OAUTH_CLIENT_ID가 설정되지 않았습니다.');
      }
      btn.textContent = 'Notion 인증 중...';
      const { code, redirectUri } = await startOAuthFlow();
      btn.textContent = '연결 중...';
      ({ token, workspaceName, duplicatedTemplateId } = await exchangeCodeForToken(code, redirectUri));
      // 이름 필드가 비어 있으면 워크스페이스 이름 자동 채우기
      const nameInput = document.getElementById('connNameInput');
      if (!nameInput.value.trim() && workspaceName) nameInput.value = workspaceName;
    } else {
      token = document.getElementById('tokenInput').value.trim();
      if (!token) throw new Error('Notion 통합 토큰을 입력해주세요');
    }

    // ── DB 설정 ────────────────────────────────────────────────
    const onStep = (msg) => { btn.textContent = msg; };
    let dbResult;
    if (!isConnect) {
      // OAuth면 템플릿 복사본 우선, 없으면 직접 생성
      dbResult = (isOAuth && duplicatedTemplateId)
        ? await connectFromTemplate(token, duplicatedTemplateId, onStep)
        : await createDatabases(token, onStep);
    } else {
      btn.textContent = '연결 확인 중...';
      const padletDbId = normalizeDbId(document.getElementById('padletDbInput').value);
      const postDbId   = normalizeDbId(document.getElementById('postDbInput').value);
      if (!padletDbId || !postDbId) throw new Error('DB ID를 모두 입력해주세요');

      const [padletDb, postDb] = await Promise.all([
        notionRequest('GET', `/v1/databases/${padletDbId}`, null, token),
        notionRequest('GET', `/v1/databases/${postDbId}`, null, token),
      ]);

      const pp = padletDb.properties;
      const qp = postDb.properties;

      // connectFromTemplate 과 동일한 findPropId 기반 매핑 사용
      // (템플릿 DB·수동 생성 DB 모두 지원)
      const padletProps = {
        title:     findTitlePropId(pp),
        boardId:   findPropId(pp, '패들렛 ID', 'Padlet ID', 'Board ID', 'boardId'),
        url:       findPropId(pp, '패들렛 URL', 'Padlet URL', 'URL', 'Link'),
        creator:   findPropId(pp, '패들렛 생성자', '생성자', 'Creator', 'Author'),
        createdAt: findPropId(pp, '패들렛 생성 일시', '패들렛 생성일시', '생성 일시', 'Created', 'Created At', 'Created Time'),
        editedAt:  findPropId(pp, '패들렛 최종 편집 일시', '최종 편집 일시', 'Last Edited', 'Updated', 'Modified'),
      };
      const postProps = {
        title:     findTitlePropId(qp),
        section:   findPropId(qp, '섹션 제목', '섹션', 'Section', 'Category'),
        body:      findPropId(qp, '본문', 'Body', 'Content', 'Text'),
        link:      findPropId(qp, '링크', 'Link', 'URL'),
        image:     findPropId(qp, '이미지', 'Image', 'Attachment'),
        postUrl:   findPropId(qp, '포스트 URL', 'Post URL', 'Post Link'),
        author:    findPropId(qp, '작성자', 'Author', 'Creator'),
        postId:    findPropId(qp, '포스트 ID', 'Post ID', 'postId', 'ID'),
        createdAt: findPropId(qp, '포스트 생성 일시', '포스트 생성일시', '생성 일시', 'Created', 'Created At', 'Created Time'),
        padlet:    findPropId(qp, '패들렛', 'Padlet', 'Board') ?? findRelationPropId(qp),
      };

      // 필수 3개만 검증 (나머지는 null이어도 저장 시 건너뜀)
      const mustHave = [
        [padletProps.boardId, '패들렛 DB의 ID 속성 (패들렛 ID 또는 Padlet ID)'],
        [postProps.postId,    '포스트 DB의 ID 속성 (포스트 ID 또는 Post ID)'],
        [postProps.padlet,    '포스트 DB의 패들렛 관계(Relation) 속성'],
      ];
      const missing = mustHave.filter(([id]) => !id).map(([, label]) => label);
      if (missing.length) {
        throw new Error(
          `필수 속성을 찾을 수 없습니다:\n• ${missing.join('\n• ')}\n` +
          `이 앱으로 생성된 DB가 아니라면 "새 DB 자동 생성"을 사용하세요.`
        );
      }

      dbResult = { padletDbId, postDbId, padletProps, postProps };
    }

    // ── 연결 배열에 추가 ───────────────────────────────────────
    const connections = await loadConnections();
    const connName =
      document.getElementById('connNameInput').value.trim() ||
      workspaceName ||
      `연결 ${connections.length + 1}`;
    const newConn = {
      id:          crypto.randomUUID(),
      name:        connName,
      notionToken: token,
      ...dbResult,
    };
    connections.push(newConn);
    await saveConnections(connections);

    renderConnectionList(connections);
    showView('listView');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    updateSettingsUI();
  }
});

// ─── 온보딩 ───────────────────────────────────────────────────────────────────
document.getElementById('oauthStartBtn').addEventListener('click', async () => {
  const btn     = document.getElementById('oauthStartBtn');
  const errorEl = document.getElementById('onboardingError');
  btn.disabled  = true;
  errorEl.classList.add('hidden');

  try {
    if (OAUTH_CLIENT_ID === 'YOUR_NOTION_CLIENT_ID') {
      throw new Error('OAuth가 아직 설정되지 않았습니다. 수동으로 설정해주세요.');
    }
    btn.textContent = 'Notion 인증 중...';
    const { code, redirectUri } = await startOAuthFlow();
    btn.textContent = '연결 중...';
    const { token, workspaceName, duplicatedTemplateId } = await exchangeCodeForToken(code, redirectUri);

    const onStep = (msg) => { btn.textContent = msg; };
    const dbResult = duplicatedTemplateId
      ? await connectFromTemplate(token, duplicatedTemplateId, onStep)
      : await createDatabases(token, onStep);

    // DB 설정 완료 → 이름 입력 단계
    pendingConnection = { id: crypto.randomUUID(), notionToken: token, ...dbResult };
    const nameInput = document.getElementById('onboardingNameInput');
    nameInput.value       = workspaceName || '';
    nameInput.placeholder = workspaceName || '연결 이름을 입력하세요';

    btn.classList.add('hidden');
    document.getElementById('goToSettingsBtn').classList.add('hidden');
    document.getElementById('onboardingNameSection').classList.remove('hidden');
    nameInput.focus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Notion 계정 연결';
  }
});

document.getElementById('goToSettingsBtn').addEventListener('click', () => {
  document.getElementById('authToken').checked   = true;
  document.getElementById('modeConnect').checked = true;
  document.getElementById('connNameInput').value  = '';
  document.getElementById('tokenInput').value    = '';
  document.getElementById('padletDbInput').value = '';
  document.getElementById('postDbInput').value   = '';
  updateSettingsUI();
  showView('settingsView');
});

// ─── 온보딩: 이름 확정 후 저장 ───────────────────────────────────────────────
document.getElementById('onboardingConfirmBtn').addEventListener('click', async () => {
  if (!pendingConnection) return;

  const nameInput = document.getElementById('onboardingNameInput');
  const name      = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#c5221f';
    return;
  }
  nameInput.style.borderColor = '';

  const connections = await loadConnections();
  connections.push({ ...pendingConnection, name });
  await saveConnections(connections);
  pendingConnection = null;

  renderConnectionList(connections);
  showView('listView');
});
