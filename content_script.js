// ─── 한국어 날짜 파싱 ─────────────────────────────────────────────────────────
function parseKoreanDate(str) {
  if (!str) return null;
  try {
    const m = str.match(/([오전오후]+)\s+(\d+):(\d+)\s+[•·]\s+(\d+)년\s+(\d+)월\s+(\d+)일/);
    if (!m) return null;
    const [, ampm, h, min, year, month, day] = m;
    let hour = parseInt(h);
    if (ampm === '오후' && hour !== 12) hour += 12;
    if (ampm === '오전' && hour === 12) hour = 0;
    return new Date(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` +
      `T${String(hour).padStart(2, '0')}:${min}:00+09:00`
    ).toISOString();
  } catch {
    return null;
  }
}

// ─── DOM 파싱 (cheerio → vanilla DOM) ────────────────────────────────────────
function parsePadlet() {
  // 보드 정보
  const boardTitle = document.querySelector('[data-testid="surfaceTitle"]')?.textContent?.trim() || '';
  const boardUrl = document.querySelector('link[rel="canonical"]')?.href || '';
  const boardId = boardUrl.split('/').filter(Boolean).pop() || '';

  let dateCreated = null, dateModified = null, boardCreator = null;
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    try {
      const json = JSON.parse(el.textContent);
      if (json.dateCreated) dateCreated = json.dateCreated;
      if (json.dateModified) dateModified = json.dateModified;
      if (json.author?.name) boardCreator = json.author.name;
    } catch {}
  });

  const board = { boardTitle, boardId, boardUrl, boardCreator, dateCreated, dateModified };

  // 지도 레이아웃 감지 → 미지원 안내
  if (document.querySelector('[data-testid^="map-post-list-item-"]')) {
    throw new Error('지도 레이아웃은 아직 지원되지 않습니다');
  }

  // 포스트 목록
  const posts = [];
  document.querySelectorAll('[data-testid="postWrapper"]').forEach(wrapper => {
    const postId = wrapper.getAttribute('data-id') || wrapper.getAttribute('data-post-cid') || null;
    const article = wrapper.querySelector('[data-testid="surfacePost"]');
    if (!article) return;

    const title = (article.querySelector('[data-testid="postSubject"]') || article.querySelector('[data-testid="surfacePostsTableRowSubject"]'))?.textContent?.trim() || '';
    const body = (article.querySelector('[data-testid="postBody"]') || article.querySelector('[data-testid="surfacePostBody"]'))?.textContent?.trim() || '';

    // 섹션: 가장 가까운 <section>의 제목
    const section = wrapper.closest('section')
      ?.querySelector('[data-testid="sectionTitleText"]')
      ?.textContent?.trim() || '';

    // 작성자: 로그인 유저 → aria-label, 게스트 → img[alt]
    const authorEl = article.querySelector('[data-testid^="surfacePostAuthor-"]');
    const authorLabel = authorEl?.getAttribute('aria-label') || '';
    const author = authorLabel.replace(' 프로필로 이동', '').trim()
      || authorEl?.querySelector('img')?.getAttribute('alt')?.replace('의 아바타', '').trim()
      || '';

    const postDate = parseKoreanDate(
      article.querySelector('time')?.getAttribute('title') || null
    );

    // 첨부 타입 분기
    const attachEl = article.querySelector('[data-testid="showAttachmentPreview"]');
    const attachHref = attachEl?.getAttribute('href') || null;
    const ariaLabel = attachEl?.getAttribute('aria-label') ?? '';

    let link = null, imageUrl = null, postUrl = null;
    if (attachHref) {
      if (ariaLabel === '확장 보기에서 첨부 파일 열기') {
        imageUrl = attachEl
          .querySelector('img[data-testid="beethovenAttachmentPreviewImageThumbnail"]')
          ?.getAttribute('src') || null;
        postUrl = attachHref;
      } else {
        link = attachHref;
      }
    }

    posts.push({ postId, title, body, section, author, postDate, link, imageUrl, postUrl });
  });

  return { board, posts };
}

// ─── 메시지 리스너 ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'parsePadlet') {
    try {
      const data = parsePadlet();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true; // 비동기 응답 채널 유지
});
