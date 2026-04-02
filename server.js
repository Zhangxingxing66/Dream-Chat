import http from 'http';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const PORT = process.env.PORT || 3001;

// 免费天气 API（wttr.in，无需 key）
const WTTR_HOST = 'wttr.in';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  // ── /api/chat ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/chat') {
    collectBody(req, (err, body) => {
      if (err) return sendError(res, 400, '请求格式错误');
      const { messages, tools } = body;
      handleStreamRequest(messages, tools, res);
    });
    return;
  }

  // ── /api/weather ───────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/weather') {
    collectBody(req, (err, body) => {
      if (err) return sendError(res, 400, '请求格式错误');
      const { city, unit = 'celsius' } = body;
      handleWeatherRequest(city, unit, res);
    });
    return;
  }

  // ── /api/search ────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/search') {
    collectBody(req, (err, body) => {
      if (err) return sendError(res, 400, '请求格式错误');
      const { query, count = 5 } = body;
      handleSearchRequest(query, count, res);
    });
    return;
  }

  // ── /health ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', message: 'AI Chat API is running' }));
    return;
  }

  res.statusCode = 404;
  res.end();
});

// ── 工具函数 ────────────────────────────────────────────────────────────────

function collectBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      callback(null, JSON.parse(body));
    } catch (e) {
      callback(e);
    }
  });
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message }));
}

function sendJSON(res, data) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// ── /api/chat 处理 ──────────────────────────────────────────────────────────

function handleStreamRequest(messages, tools, res) {
  const requestBody = {
    model: 'deepseek-chat',
    messages,
    max_tokens: 4000,
    temperature: 0.7,
    stream: true
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = 'auto';
  }

  const options = {
    hostname: 'api.deepseek.com',
    port: 443,
    path: '/chat/completions',
    method: 'POST',
    timeout: 60000,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'User-Agent': 'Node.js-Client',
      'Accept': '*/*'
    }
  };

  const req = https.request(options, (apiRes) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    apiRes.pipe(res);
    apiRes.on('end', () => console.log('响应结束'));
  });

  req.on('error', (error) => {
    console.error('请求错误:', error);
    res.write(`data: {"error": "请求失败: ${error.message}"}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  req.write(JSON.stringify(requestBody));
  req.end();
}

// ── /api/weather 处理（wttr.in 免费接口）────────────────────────────────────

function handleWeatherRequest(city, unit, res) {
  // wttr.in 支持 format=j1 返回 JSON
  const encodedCity = encodeURIComponent(city);
  const path = `/${encodedCity}?format=j1&lang=zh`;

  const options = {
    hostname: WTTR_HOST,
    port: 443,
    path,
    method: 'GET',
    timeout: 10000,
    headers: { 'User-Agent': 'curl/7.68.0' }
  };

  const wttrReq = https.request(options, (wttrRes) => {
    let data = '';
    wttrRes.on('data', (chunk) => { data += chunk; });
    wttrRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        const current = json.current_condition?.[0];
        const area = json.nearest_area?.[0];

        if (!current) {
          return sendJSON(res, { error: `未找到城市 "${city}" 的天气数据` });
        }

        const tempC = parseInt(current.temp_C);
        const tempF = parseInt(current.temp_F);
        const temp = unit === 'fahrenheit' ? `${tempF}°F` : `${tempC}°C`;
        const description = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知';

        sendJSON(res, {
          city,
          area: area?.areaName?.[0]?.value || city,
          temperature: temp,
          feels_like: unit === 'fahrenheit' ? `${current.FeelsLikeF}°F` : `${current.FeelsLikeC}°C`,
          description,
          humidity: `${current.humidity}%`,
          wind_speed: `${current.windspeedKmph} km/h`,
          wind_direction: current.winddir16Point,
          visibility: `${current.visibility} km`,
          uv_index: current.uvIndex
        });
      } catch (e) {
        sendJSON(res, { error: '天气数据解析失败', detail: e.message });
      }
    });
  });

  wttrReq.on('error', (e) => sendJSON(res, { error: `天气查询失败: ${e.message}` }));
  wttrReq.end();
}

// ── /api/search 处理（DuckDuckGo Instant Answer API，免费无需 key）──────────

function handleSearchRequest(query, count, res) {
  const encodedQuery = encodeURIComponent(query);
  const path = `/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

  const options = {
    hostname: 'api.duckduckgo.com',
    port: 443,
    path,
    method: 'GET',
    timeout: 10000,
    headers: { 'User-Agent': 'dreamAI-search/1.0' }
  };

  const ddgReq = https.request(options, (ddgRes) => {
    let data = '';
    ddgRes.on('data', (chunk) => { data += chunk; });
    ddgRes.on('end', () => {
      try {
        const json = JSON.parse(data);

        const results = [];

        // Abstract（摘要，如维基百科）
        if (json.AbstractText) {
          results.push({
            title: json.Heading || query,
            snippet: json.AbstractText,
            url: json.AbstractURL || '',
            source: json.AbstractSource || 'DuckDuckGo'
          });
        }

        // RelatedTopics
        for (const topic of json.RelatedTopics || []) {
          if (results.length >= count) break;
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
              snippet: topic.Text,
              url: topic.FirstURL,
              source: 'DuckDuckGo'
            });
          }
          // Topics 里有嵌套的 Topics
          if (topic.Topics) {
            for (const sub of topic.Topics) {
              if (results.length >= count) break;
              if (sub.Text && sub.FirstURL) {
                results.push({
                  title: sub.Text.slice(0, 60),
                  snippet: sub.Text,
                  url: sub.FirstURL,
                  source: 'DuckDuckGo'
                });
              }
            }
          }
        }

        if (results.length === 0) {
          sendJSON(res, {
            query,
            results: [],
            note: '未找到相关结果，建议换一个关键词或直接访问搜索引擎'
          });
        } else {
          sendJSON(res, { query, results: results.slice(0, count) });
        }
      } catch (e) {
        sendJSON(res, { error: '搜索结果解析失败', detail: e.message });
      }
    });
  });

  ddgReq.on('error', (e) => sendJSON(res, { error: `搜索失败: ${e.message}` }));
  ddgReq.end();
}

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
