// 德仁口腔AI助手 - Node.js 版自动更新（无需 Python）
const https = require('https');
const fs = require('fs');

const OWNER = 'mahousen';
const REPO = 'dr-ai-v2';

function fetchFile(name) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/${name}`,
      headers: { 'User-Agent': 'dr-ai-v2-updater' }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.content) {
            resolve(Buffer.from(json.content, 'base64').toString('utf-8'));
          } else {
            reject(new Error(json.message || 'Unknown error'));
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    const remote = (await fetchFile('version.txt')).trim();
    let local = '';
    try { local = fs.readFileSync('version.txt', 'utf-8').trim(); } catch (_) {}

    if (local === remote) {
      console.log(`已是最新版本 (${local})`);
      return;
    }

    console.log(`发现新版本: ${remote} (当前: ${local || '无'})`);
    console.log('正在更新...');

    const files = ['index.html', 'server.js', 'version.txt', 'check_update.js', 'check_update.py', 'package.json'];
    for (const f of files) {
      try {
        const content = await fetchFile(f);
        fs.writeFileSync(f, content, 'utf-8');
        console.log(`  OK  ${f}`);
      } catch (e) {
        console.log(`  ERR ${f}: ${e.message}`);
      }
    }
    console.log('更新完成！');
  } catch (e) {
    console.log('检查更新失败:', e.message);
  }
}

main();
