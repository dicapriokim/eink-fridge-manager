require('dotenv').config();
const express = require('express');
// [무결성 교정] NAS가 HA의 HTTPS 인증서 불일치를 무시하고 직통 연결하도록 강제 허용
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const path = require('path');
const fs = require('fs').promises;

// [Expert] 구버전 Node.js(v16 이하) 호환성을 위한 fetch 체크
if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
    console.log('[SYSTEM] Node.js 버전에 따라 node-fetch 폴리필을 로드했습니다.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log('--------------------------------------------------');
console.log('[eink-fridge-manager] v.5.2.4 (Integrity Audited)');
console.log('--------------------------------------------------');

const generateId = () => `cat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

async function writeData(data) {
    const TEMP_FILE = `${DATA_FILE}.tmp`;
    try {
        await fs.writeFile(TEMP_FILE, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(TEMP_FILE, DATA_FILE);
    } catch (err) {
        console.error('[DATABASE] 쓰기 치명적 오류 (원자적 쓰기 실패):', err);
        // 실패 시 임시 파일 삭제 시도
        try { await fs.unlink(TEMP_FILE); } catch (e) { }
    }
}

async function readData() {
    try {
        const raw = await fs.readFile(DATA_FILE, 'utf8');
        let data = JSON.parse(raw);

        if (!data.categories) {
            console.log('[MIGRATION] v3 -> v4 시스템 마이그레이션 실행...');
            const categories = [];
            const oldKeys = ['fridge', 'freezer', 'pantry'];
            const names = { fridge: '냉장고', freezer: '냉동고', pantry: '팬트리' };

            oldKeys.forEach(key => {
                if (data[key]) {
                    categories.push({
                        id: `legacy_${key}`,
                        name: names[key],
                        config: { count: 9, script_entity: '', mode: 'short' },
                        items: data[key]
                    });
                }
            });

            if (categories.length === 0) {
                categories.push({
                    id: generateId(),
                    name: '냉장고',
                    config: { count: 9, script_entity: '' },
                    items: []
                });
            }

            data = { categories };
            await writeData(data);
            console.log('[MIGRATION] 마이그레이션 성공.');
        }
        return data;
    } catch (err) {
        if (err.code === 'ENOENT') {
            const initial = { categories: [{ id: generateId(), name: '냉장고', config: { count: 9, script_entity: '' }, items: [] }] };
            await writeData(initial);
            return initial;
        }
        console.error('[DATABASE] 읽기 무결성 훼손:', err);
        return { categories: [] };
    }
}

// [Expert] 비동기 에러 핸들러 래퍼 (서버 중단 방지)
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- API 엔드포인트 (v4.2.2 상세 로그 및 무결성 보강) ---

app.get('/api/categories', asyncHandler(async (req, res) => {
    console.log(`[API] ${new Date().toISOString()} - 카테고리 목록 요청`);
    const data = await readData();
    if (!data || !data.categories) {
        console.error('[CRITICAL] 데이터 구조 파손 감지');
        return res.status(500).json({ error: 'DB 구조 파손', detail: 'categories 배열을 읽을 수 없습니다.' });
    }
    const list = data.categories.map(c => ({
        id: c.id,
        name: c.name,
        config: c.config || { count: 9, script_entity: '' }
    }));
    res.json(list);
}));

app.post('/api/categories', asyncHandler(async (req, res) => {
    const { name } = req.body;
    const data = await readData();
    if (data.categories.length >= 4) return res.status(400).json({ error: '최대 4개까지만 가능합니다.' });

    const newCat = { id: generateId(), name: name || '새 탭', config: { count: 9, script_entity: '', mode: 'short' }, items: [] };
    data.categories.push(newCat);
    await writeData(data);
    res.json(newCat);
}));

app.patch('/api/categories/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, config } = req.body;
    const data = await readData();
    const index = data.categories.findIndex(c => c.id === id);
    if (index === -1) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });

    if (name) data.categories[index].name = name;
    if (config) data.categories[index].config = { ...data.categories[index].config, ...config };
    await writeData(data);
    res.json(data.categories[index]);
}));

app.delete('/api/categories/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = await readData();
    if (data.categories.length <= 1) return res.status(400).json({ error: '최소 1개의 탭은 유지해야 합니다.' });
    data.categories = data.categories.filter(c => c.id !== id);
    await writeData(data);
    res.json({ success: true });
}));

app.get('/api/inventory/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = await readData();
    const cat = data.categories.find(c => c.id === id);
    if (!cat) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다.' });
    res.json(cat.items);
}));

app.get('/api/ha/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = await readData();
    const catIndex = data.categories.findIndex(c => c.id === id);
    const cat = data.categories[catIndex];

    if (!cat) return res.status(404).json({ error: 'HA 센서 대상을 찾을 수 없습니다.' });

    res.json({
        id: cat.id,
        slot: String(catIndex + 1), // 신규 추가 (일관성 확보)
        name: cat.name,
        mode: cat.config?.mode || 'short',
        count: cat.config?.count || 9, // count 명시적 포함
        items: cat.items || []
    });
}));

// [Expert] 시각적 가중치 기반 문자열 절삭 (ASCII 1점, 그 외 2점)
function truncateVisualLength(str, maxWeight) {
    if (!str) return '';
    const normalized = str.normalize('NFC');
    let weight = 0;
    let result = '';
    for (const char of normalized) {
        const charWeight = char.charCodeAt(0) > 128 ? 2 : 1;
        if (weight + charWeight > maxWeight) break;
        weight += charWeight;
        result += char;
    }
    return result;
}

// [Expert] 입력값 검증 (Point 3)
function validateItem(item, mode = 'short') {
    if (!item) return false;
    if (mode === 'long') {
        item.pummog = truncateVisualLength(item.pummog, 40);
        item.suryang = "";
    } else {
        if (item.pummog && item.pummog.length > 6) item.pummog = item.pummog.substring(0, 6);
        if (item.suryang && item.suryang.length > 3) item.suryang = item.suryang.substring(0, 3);
    }
    return true;
}

// [v4.3.1] 일괄 저장 (Bulk API) - 동시성 충돌 방지 및 성능 최적화
app.post('/api/inventory/:catId/bulk', asyncHandler(async (req, res) => {
    const { catId } = req.params;
    const { items } = req.body;
    const data = await readData();
    const cat = data.categories.find(c => c.id === catId);

    if (cat) {
        const mode = cat.config?.mode || 'short';
        // [Point 3] 서버측 검증 적용
        const validatedItems = items.map(it => {
            validateItem(it, mode);
            return it;
        });
        cat.items = validatedItems;
        await writeData(data);
        res.json({ success: true, count: validatedItems.length });
    } else {
        res.status(404).json({ error: '카테고리를 찾을 수 없습니다.' });
    }
}));

app.post('/api/inventory/:catId/:idx', asyncHandler(async (req, res) => {
    const { catId, idx } = req.params;
    const { pummog, suryang } = req.body;
    const data = await readData();
    const cat = data.categories.find(c => c.id === catId);
    if (!cat) return res.status(404).json({ error: '저장 대상을 찾을 수 없습니다.' });

    const mode = cat.config?.mode || 'short';
    const newItem = { id: parseInt(idx), pummog, suryang };
    validateItem(newItem, mode);

    const itemIdx = cat.items.findIndex(it => it.id == idx);
    if (itemIdx !== -1) cat.items[itemIdx] = newItem;
    else cat.items.push(newItem);

    await writeData(data);
    res.json({ success: true });
}));

app.post('/api/refresh/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { items: incomingItems } = req.body; // [Point 2] 클라이언트에서 보낸 최신 데이터 우선 사용
    const data = await readData();
    const cat = data.categories.find(c => c.id === id);

    if (!cat || !cat.config.script_entity) {
        return res.status(400).json({ error: '설정 오류', detail: '해당 탭에 HA 스크립트가 설정되어 있지 않습니다.' });
    }

    const script_id = cat.config.script_entity;
    const parts = script_id.split('.');
    const domain = parts[0] || 'script';
    const service = parts[1] || script_id;

    const itemsToProcess = incomingItems || cat.items || [];
    const mode = cat.config?.mode || 'short';
    const catIndex = data.categories.findIndex(c => c.id === id);
    const flattenedVariables = {
        id: id,            // 원본 고유 ID 유지 (String)
        slot: String(catIndex + 1), // 신규 슬롯 번호 (String "1", "2", "3", "4")
        category: cat.name,
        mode: mode,
        count: itemsToProcess.length
    };

    // [v5.1.3] HA 템플릿 에러 방지를 위한 9개 항목 패딩 처리
    for (let i = 1; i <= 9; i++) {
        flattenedVariables[`pummog${i}`] = '';
        flattenedVariables[`suryang${i}`] = '';
    }

    // [Point 2 & Point 3] 만약 새로운 데이터가 왔다면 즉시 저장 (레이스 컨디션 방지)
    if (incomingItems) {
        const validatedItems = incomingItems.map(it => {
            validateItem(it, mode);
            return it;
        });
        cat.items = validatedItems;
        await writeData(data);
    }

    itemsToProcess.forEach((item, index) => {
        if (index < 9) { // 최대 9개까지만 변수 주입
            validateItem(item, mode);
            flattenedVariables[`pummog${index + 1}`] = '\uFEFF' + (item.pummog || '').replace(/ /g, '\u00A0');
            flattenedVariables[`suryang${index + 1}`] = item.suryang || '';
        }
    });

    // [v4.2.7] URL 정제 (Trailing Slash 제거)
    const base_url = process.env.HA_URL.replace(/\/$/, "");
    const targetUrl = `${base_url}/api/services/${domain}/${service}`;
    const fallbackUrl = `${base_url}/api/services/script/turn_on`;

    // [v5.0.8] 토큰 공백 제거 (안전성 확보)
    const token = (process.env.HA_TOKEN || '').trim();

    try {
        console.log(`[HA SYNC] 서비스 호출 시도: ${targetUrl} (Slot: ${catIndex + 1})`);
        console.log(`[HA SYNC] 전송 데이터 요약: ID=${id}, Slot=${catIndex + 1}, Mode=${mode}, Count=${itemsToProcess.length}`);

        // 1차 시도: 직접 서비스 호출
        let response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(flattenedVariables)
        });

        // [Point 4] 404 뿐만 아니라 통신 실패 전반에 대해 폴백 시도
        if (!response.ok) {
            console.log(`[HA SYNC] 1차 시도 실패(상태: ${response.status}), 폴백 시도: ${fallbackUrl}`);
            const fallbackResponse = await fetch(fallbackUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ entity_id: script_id, variables: flattenedVariables })
            });

            if (fallbackResponse.ok) {
                response = fallbackResponse;
            }
        }

        if (response.ok) {
            res.json({ success: true });
        } else {
            const detail = await response.text();
            console.error(`[HA ERROR] 최종 실패 - 상태코드: ${response.status}, 내용: ${detail}`);
            res.status(response.status).json({
                error: 'HA 통신 실패',
                detail: `(HA 응답 ${response.status}) ${detail || '서비스를 찾을 수 없습니다.'}`
            });
        }
    } catch (err) {
        console.error('[HA NETWORK ERROR]', err);
        res.status(500).json({ error: 'HA 접속 불가', detail: '나스에서 HA로 연결할 수 없습니다. URL 및 토큰을 확인하세요.' });
    }
}));

// 공통 에러 핸들러 (JSON 응답 및 상세 원인 공개)
app.use((err, req, res, next) => {
    console.error('[CRITICAL ERROR]', err);
    res.status(500).json({ error: '서버 내부 오류', detail: err.message });
});

app.listen(PORT, () => {
    console.log(`[v.5.2.4] 서버 가동 중: http://localhost:${PORT}`);
});
