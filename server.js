// 德仁口腔 AI 助手 v2 - 最小化服务端
// 1. 提供静态文件  2. HTTP STT  3. WebSocket 实时 STT 中继
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = 8080;
const DASHSCOPE_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

// ---- 数据文件存储（坚果云同步）----
const HOME = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '';
// 坚果云路径自动检测（支持新旧版本目录结构）
function detectNutCloudDir() {
  const candidates = [
    // 新版坚果云路径（Nutstore/1/ 子目录结构）
    path.join(HOME, 'Nutstore', '1', '我的坚果云'),
    path.join(HOME, 'Nutstore', '我的坚果云'),
    // 旧版路径（直接在HOME下）
    path.join(HOME, '我的坚果云'),
    path.join(HOME, 'NutCloud'),
    path.join(HOME, '坚果云'),
    path.join(HOME, 'JianguoCloud'),
  ];
  for (const d of candidates) {
    try {
      if (fs.existsSync(d)) {
        log('坚果云检测成功: ' + d);
        return d;
      }
    } catch (_) {}
  }
  // 深度扫描：尝试在 Nutstore 子目录中寻找
  const nutstoreBase = path.join(HOME, 'Nutstore');
  try {
    if (fs.existsSync(nutstoreBase)) {
      const subdirs = fs.readdirSync(nutstoreBase);
      for (const sub of subdirs) {
        for (const name of ['我的坚果云', 'NutCloud', '坚果云', 'JianguoCloud']) {
          const fullPath = path.join(nutstoreBase, sub, name);
          try {
            if (fs.existsSync(fullPath)) {
              log('坚果云深度检测成功: ' + fullPath);
              return fullPath;
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  log('坚果云未检测到，使用本地数据目录');
  return null;
}
const NUT_DIR = detectNutCloudDir();
let DATA_DIR = NUT_DIR ? path.join(NUT_DIR, '德仁AI数据') : path.join(__dirname, 'dr-data');
// 确保数据目录存在
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

// 生成本机唯一ID（用医生名+主机名的哈希）
function getComputerId() {
  const host = process.env.COMPUTERNAME || process.env.HOSTNAME || 'pc';
  return host.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) + '-' + Date.now().toString(36).slice(-4);
}
const COMPUTER_ID_FILE = path.join(DATA_DIR, '.computer-id');
let COMPUTER_ID;
try { COMPUTER_ID = fs.readFileSync(COMPUTER_ID_FILE, 'utf-8').trim(); } catch (_) {
  COMPUTER_ID = getComputerId();
  try { fs.writeFileSync(COMPUTER_ID_FILE, COMPUTER_ID, 'utf-8'); } catch (_) {}
}

function getLocalDataFile() {
  return path.join(DATA_DIR, 'dr-data-' + COMPUTER_ID + '.json');
}

function readLocalData() {
  const file = getLocalDataFile();
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return { clinicName: '', doctorName: '', computerId: COMPUTER_ID, records: [] };
  }
}

function writeLocalData(data) {
  const file = getLocalDataFile();
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {
    log('写入数据文件失败: ' + e.message);
    throw e; // 抛出异常，让调用方知道写入失败
  }
}

function readAllData() {
  const allRecords = [];
  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const f of files) {
      if (f.startsWith('dr-data-') && f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
          const data = JSON.parse(raw);
          if (data.records && Array.isArray(data.records)) {
            for (const rec of data.records) {
              rec._source = f; // 标记来源文件
              allRecords.push(rec);
            }
          }
        } catch (_) { /* skip corrupt files */ }
      }
    }
  } catch (_) {}
  // 按时间排序（最新的在前）
  allRecords.sort((a, b) => (b.id || 0) - (a.id || 0));
  return allRecords;
}

// ---- 静态文件 MIME ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// ---- 百炼 STT ----
function dashScopeSTT(pcmBuffer, apiKey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DASHSCOPE_WS, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    const taskId = `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    let fullText = '';
    let done = false;
    let timer = null;

    function finish(err, text) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      if (err) reject(err);
      else resolve(text || '');
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: 'fun-asr-realtime',
          parameters: { format: 'pcm', sample_rate: 16000, language_hints: ['zh'] },
          input: {}
        }
      }));
    });

    let audioSent = false;
    // fun-asr-realtime 返回当前句子的全量文本（非增量）
    // 需要用 sentence_end 判断是否定稿，定稿才追加到 confirmedText
    let confirmedText = '';    // 已定稿的句子
    let currentSentence = '';  // 当前未定稿句子（实时刷新）

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const evt = msg.header?.event;

        if (evt === 'task-started' && !audioSent) {
          audioSent = true;
          const SIZE = 6400;
          let off = 0;
          function sendChunk() {
            if (done) return;
            if (off >= pcmBuffer.length) {
              ws.send(JSON.stringify({
                header: { action: 'finish-task', task_id: taskId },
                payload: { input: {} }
              }));
              return;
            }
            ws.send(pcmBuffer.slice(off, Math.min(off + SIZE, pcmBuffer.length)));
            off += SIZE;
            timer = setTimeout(sendChunk, 15);
          }
          sendChunk();
        } else if (evt === 'task-failed') {
          const code = msg.payload?.error?.code || msg.header?.error_code || '';
          const msgText = msg.payload?.error?.message || msg.header?.error_message || '未知错误';
          finish(new Error(`[${code}] ${msgText}`), '');
        } else if (evt === 'task-finished') {
          // task-finished payload.output 为空，用已收集的文本
          if (currentSentence) confirmedText += currentSentence;
          fullText = confirmedText.trim();
          finish(null, fullText);
        } else if (evt === 'result-generated') {
          const output = msg.payload?.output || {};
          // 百炉返回结构: output.sentence.{ text, sentence_end }
          const sentence = output.sentence || {};
          const t = sentence.text || '';
          const sentenceEnd = sentence.sentence_end === true;
          if (sentenceEnd) {
            // 该句定稿，追加到已确认文本
            if (t) confirmedText += t;
            currentSentence = '';
          } else {
            // 未定稿，替换当前句（不累加！）
            currentSentence = t;
          }
          fullText = confirmedText + currentSentence;
        } else if (evt) {
          // 未知事件忽略
        }
      } catch (_) { /* binary frame, ignore */ }
    });

    ws.on('error', (e) => finish(e, ''));
    ws.on('close', (code) => {
      if (!done) {
        if (fullText.trim()) finish(null, fullText.trim());
        else finish(new Error(`连接关闭 (code:${code})`), '');
      }
    });

    setTimeout(() => finish(new Error('转写超时'), ''), 300000);
  });
}

// Debug: write logs to file for troubleshooting
const LOG_FILE = path.join(__dirname, 'server-debug.log');
function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}
// Clear log on start
try { fs.writeFileSync(LOG_FILE, ''); } catch (_) {}

// ---- 实时 STT WebSocket 中继 ----
function handleSttStream(browserWs, apiKey) {
  log('STT-WS: 新连接, key=' + apiKey.slice(0, 8) + '...');
  const dashWs = new WebSocket(DASHSCOPE_WS, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  const taskId = `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  let confirmedText = '', currentSentence = '';
  let started = false, done = false;
  let sendQueue = [];  // 百炼未就绪前缓存的音频数据

  function cleanup() {
    if (done) return; done = true;
    try { dashWs.close(); } catch (_) {}
    try { browserWs.close(); } catch (_) {}
  }

  dashWs.on('open', () => {
    log('STT-WS: 百炼WS已连接, 发送run-task');
    dashWs.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio', task: 'asr', function: 'recognition',
        model: 'fun-asr-realtime',
        parameters: { format: 'pcm', sample_rate: 16000, language_hints: ['zh'] },
        input: {}
      }
    }));
  });

  dashWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const evt = msg.header?.event;
      log('STT-WS 百炼返回: event=' + evt);

      if (evt === 'task-started') {
        started = true;
        log('STT-WS: 百炼就绪, 队列=' + sendQueue.length + ' chunks');
        for (const chunk of sendQueue) {
          if (dashWs.readyState === 1) dashWs.send(chunk);
        }
        sendQueue = [];
      } else if (evt === 'task-failed') {
        const errMsg = msg.payload?.error?.message || '转写失败';
        log('STT-WS: 失败=' + errMsg);
        if (browserWs.readyState === 1) {
          browserWs.send(JSON.stringify({ type: 'error', message: errMsg }));
        }
        cleanup();
      } else if (evt === 'task-finished') {
        if (currentSentence) confirmedText += currentSentence;
        const finalText = confirmedText.trim();
        log('STT-WS: 完成, text=' + finalText.slice(0, 40) + ' (' + finalText.length + '字)');
        if (browserWs.readyState === 1) {
          browserWs.send(JSON.stringify({ type: 'done', text: finalText }));
        }
        cleanup();
      } else if (evt === 'result-generated') {
        const sentence = msg.payload?.output?.sentence || {};
        const t = sentence.text || '';
        const sentenceEnd = sentence.sentence_end === true;
        if (sentenceEnd) {
          if (t) confirmedText += t;
          currentSentence = '';
        } else {
          currentSentence = t;
        }
        const fullText = confirmedText + currentSentence;
        if (browserWs.readyState === 1 && fullText) {
          browserWs.send(JSON.stringify({
            type: 'transcript',
            text: fullText,
            sentenceEnd
          }));
        }
      }
    } catch (_) { /* binary frame */ }
  });

  // 收到浏览器音频数据 → 转发给百炼
  browserWs.on('message', (data, isBinary) => {
    if (!isBinary || done) return;
    if (started && dashWs.readyState === 1) {
      dashWs.send(data);
    } else {
      if (sendQueue.length === 0) log('STT-WS: 缓存音频(百炼未就绪)');
      sendQueue.push(data);
    }
  });

  // 浏览器关闭 → 发送 finish
  browserWs.on('close', () => {
    log('STT-WS: 浏览器断开, started=' + started);
    if (!done && started && dashWs.readyState === 1) {
      dashWs.send(JSON.stringify({
        header: { action: 'finish-task', task_id: taskId },
        payload: { input: {} }
      }));
    }
    setTimeout(() => { if (!done) { log('STT-WS: 等待超时, 清理'); cleanup(); } }, 5000);
  });

  dashWs.on('close', (code) => {
    log('STT-WS: 百炼断开 code=' + code);
    if (!done && browserWs.readyState === 1) {
      browserWs.send(JSON.stringify({ type: 'error', message: '转写服务连接中断 (code:' + code + ')，请恢复录音以自动重连' }));
    }
    cleanup();
  });

  dashWs.on('error', (e) => {
    log('STT-WS: 百炼错误=' + e.message);
    if (!done && browserWs.readyState === 1) {
      browserWs.send(JSON.stringify({ type: 'error', message: '百炼连接失败: ' + e.message }));
    }
    cleanup();
  });

  browserWs.on('error', (e) => { log('STT-WS: 浏览器错误=' + e.message); cleanup(); });
}

// ---- Paraformer 极速文件转写（数百倍实时速度）----
async function handleTurboTranscribe(req, res, apiKey) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const buffer = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || 'audio/mpeg';
    const ext = contentType.includes('mp4') || contentType.includes('m4a') ? '.m4a'
      : contentType.includes('wav') ? '.wav'
      : contentType.includes('webm') ? '.webm'
      : contentType.includes('ogg') ? '.ogg'
      : contentType.includes('flac') ? '.flac'
      : '.mp3';
    const filename = `dr_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;

    try {
      // 1. 获取 OSS 上传凭证
      log(`Turbo: 获取上传凭证, size=${(buffer.length/1024/1024).toFixed(1)}MB`);
      const policyUrl = 'https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=paraformer-v2';
      const polResp = await fetch(policyUrl, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!polResp.ok) {
        const err = await polResp.json().catch(() => ({}));
        throw new Error((err.message || err.error || '获取上传凭证失败') + ' HTTP ' + polResp.status);
      }
      const pol = await polResp.json();
      if (pol.code) throw new Error(pol.message || pol.code);

      const { oss_access_key_id, signature, policy, upload_dir, upload_host,
              x_oss_object_acl, x_oss_forbid_overwrite } = pol;

      // 2. 上传到 OSS
      log(`Turbo: 上传到OSS host=${upload_host}`);
      const formData = new FormData();
      const key = upload_dir + filename;
      formData.append('key', key);
      formData.append('policy', policy);
      formData.append('OSSAccessKeyId', oss_access_key_id);
      formData.append('signature', signature);
      formData.append('x-oss-object-acl', x_oss_object_acl || 'private');
      formData.append('x-oss-forbid-overwrite', x_oss_forbid_overwrite || 'true');
      formData.append('file', new Blob([buffer], { type: contentType }), filename);

      const upResp = await fetch(upload_host, { method: 'POST', body: formData });
      if (!upResp.ok) {
        const errText = await upResp.text().catch(() => '');
        throw new Error('OSS上传失败 HTTP ' + upResp.status + ': ' + errText.slice(0, 200));
      }
      log(`Turbo: OSS上传成功 key=${key}`);

      // 3. 构造 oss:// URL
      const bucket = new URL(upload_host).hostname.split('.')[0];
      const ossUrl = `oss://${bucket}/${key}`;
      log(`Turbo: 提交Paraformer任务 url=${ossUrl}`);

      // 4. 提交 Paraformer 转写任务
      const taskResp = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable'
          },
          body: JSON.stringify({
            model: 'paraformer-v2',
            input: { file_urls: [ossUrl] },
            parameters: { language_hints: ['zh'] }
          })
        }
      );
      if (!taskResp.ok) {
        const err = await taskResp.json().catch(() => ({}));
        throw new Error('提交转写任务失败: ' + (err.message || err.error || 'HTTP ' + taskResp.status));
      }
      const task = await taskResp.json();
      if (task.code) throw new Error(task.message || task.code);
      const taskId = task.output?.task_id;
      if (!taskId) throw new Error('未获取到task_id: ' + JSON.stringify(task));
      log(`Turbo: 任务已提交 taskId=${taskId}`);

      // 5. 轮询结果（最多 10 分钟）
      for (let i = 0; i < 200; i++) {
        await sleep(3000);
        if (i % 5 === 0) log(`Turbo: 轮询中 #${i+1} taskId=${taskId.slice(0,8)}...`);
        const pollResp = await fetch(
          `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (!pollResp.ok) continue;
        const poll = await pollResp.json();
        const status = poll.output?.task_status;
        if (status === 'SUCCEEDED') {
          const result = poll.output.results?.[0];
          const resultUrl = result?.transcription_url;
          if (!resultUrl) throw new Error('未获取到结果URL');
          log(`Turbo: 转写完成, 下载结果 ${resultUrl.slice(0, 50)}...`);

          // 6. 下载转写结果 JSON
          const textResp = await fetch(resultUrl);
          const textData = await textResp.json();
          const fullText = (textData.transcripts || [])
            .map(t => t.text || '')
            .join('\n')
            .trim();

          const duration = poll.usage?.duration || 0;
          log(`Turbo: 结果=${fullText.slice(0, 50)}... (${fullText.length}字, 音频${duration}秒)`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: fullText, duration }));
          return;
        } else if (status === 'FAILED') {
          const errInfo = poll.output?.results?.[0]?.subtask_status || poll.output?.message || '';
          throw new Error('转写任务失败: ' + errInfo);
        }
        // PENDING/RUNNING → continue polling
      }
      throw new Error('转写超时（超过10分钟未完成）');
    } catch (e) {
      log(`Turbo: 错误=${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- HTTP Server ----
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // STT 转写
  if (req.method === 'POST' && req.url === '/api/transcribe') {
    const auth = req.headers['authorization'] || '';
    const apiKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 API Key（请先在设置中配置）' }));
      return;
    }

    // 收 PCM
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const pcm = Buffer.concat(chunks);
      log(`STT-HTTP: 收到PCM ${pcm.length}字节, key=${apiKey.slice(0,8)}...`);
      try {
        const text = await dashScopeSTT(pcm, apiKey);
        console.log(`[STT] 转写成功: "${text.slice(0,50)}${text.length>50?'...':''}" (${text.length}字)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (e) {
        console.error(`[STT] 转写失败:`, e.message);
        const msg = e.message || String(e);
        let userMsg;
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('InvalidApiKey')) {
          userMsg = 'API Key 无效，请在设置中检查并重新填写';
        } else if (msg.includes('Model') && msg.includes('not exist')) {
          userMsg = '模型不可用，请联系开发者检查';
        } else {
          userMsg = `转写失败: ${msg}`;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: userMsg }));
      }
    });
    return;
  }

  // 健康检查
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 数据目录信息
  if (req.method === 'GET' && req.url === '/api/data-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      dataDir: DATA_DIR,
      nutDir: NUT_DIR,
      computerId: COMPUTER_ID,
      localFile: getLocalDataFile(),
      autoSync: !!NUT_DIR
    }));
    return;
  }

  // 设置数据目录
  if (req.method === 'POST' && req.url === '/api/set-data-dir') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const newDir = body.dir;
        if (!newDir) { res.writeHead(400); res.end(JSON.stringify({ error: '缺少 dir 参数' })); return; }
        try { fs.mkdirSync(newDir, { recursive: true }); } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: '目录创建失败: ' + e.message })); return;
        }
        DATA_DIR = newDir;
        // 重新生成 computer ID 文件
        const newIdFile = path.join(DATA_DIR, '.computer-id');
        try { COMPUTER_ID = fs.readFileSync(newIdFile, 'utf-8').trim(); } catch (_) {
          try { fs.writeFileSync(newIdFile, COMPUTER_ID, 'utf-8'); } catch (_) {}
        }
        log('数据目录已更新: ' + DATA_DIR);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ dataDir: DATA_DIR, computerId: COMPUTER_ID }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 保存一条记录到数据文件
  if (req.method === 'POST' && req.url === '/api/save-record') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const record = JSON.parse(Buffer.concat(chunks).toString());
        const data = readLocalData();
        data.clinicName = record.clinicName || data.clinicName;
        data.doctorName = record.doctorName || data.doctorName;
        data.records.unshift(record);
        writeLocalData(data);
        log('数据保存: patient=' + (record.patient || '?') + ', 总=' + data.records.length);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, total: data.records.length }));
      } catch (e) {
        log('保存记录失败: ' + e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 批量同步 localStorage 数据到服务端（一次性迁移）
  if (req.method === 'POST' && req.url === '/api/bulk-sync') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const records = body.records || [];
        if (!Array.isArray(records) || records.length === 0) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'records 为空' })); return;
        }
        const data = readLocalData();
        data.clinicName = body.clinicName || data.clinicName;
        data.doctorName = body.doctorName || data.doctorName;
        // 去重：只添加服务端没有的记录（按 id 判断，无 id 的记录按时间+患者名去重）
        const existingKeys = new Set(data.records.map(r => r.id ? String(r.id) : (r.time || '') + '|' + (r.patient || '')));
        const newRecords = records.filter(r => {
          const key = r.id ? String(r.id) : (r.time || '') + '|' + (r.patient || '');
          return !existingKeys.has(key);
        });
        data.records = newRecords.concat(data.records); // 新记录在前
        writeLocalData(data);
        log('批量同步: 收到=' + records.length + ', 新增=' + newRecords.length + ', 总=' + data.records.length);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, added: newRecords.length, total: data.records.length }));
      } catch (e) {
        log('批量同步失败: ' + e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 获取所有数据（合并所有文件）
  if (req.method === 'GET' && req.url === '/api/get-all-data') {
    const records = readAllData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: records.length, records }));
    return;
  }

  // 导出本机数据（下载 JSON 文件）
  if (req.method === 'GET' && req.url === '/api/export-data') {
    const data = readLocalData();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dr-export-' + COMPUTER_ID + '.json"'
    });
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  // Paraformer 极速文件转写（数百倍实时速度）
  if (req.method === 'POST' && req.url === '/api/transcribe-turbo') {
    const auth = req.headers['authorization'] || '';
    const apiKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少 API Key' }));
      return;
    }
    handleTurboTranscribe(req, res, apiKey);
    return;
  }

  // 静态文件
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = '.' + filePath;
  const ext = path.extname(filePath);

  try {
    const content = fs.readFileSync(filePath);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = 'Thu, 01 Jan 1970 00:00:00 GMT';
    }
    res.writeHead(200, headers);
    res.end(content);
  } catch (_) {
    res.writeHead(404);
    res.end('404');
  }
});

// WebSocket 实时转写
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + PORT);
    if (url.pathname === '/ws/transcribe') {
      const apiKey = url.searchParams.get('key') || '';
      if (!apiKey) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleSttStream(ws, apiKey);
      });
    } else {
      socket.destroy();
    }
  } catch (e) {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`德仁口腔 AI 助手 v2 已启动: http://localhost:${PORT}`);
});
