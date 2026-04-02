/**
 * 工具执行层
 * 负责将 AI 返回的 tool_calls 路由到具体实现
 */

// 天气查询（走后端代理）
async function get_weather({ city, unit = 'celsius' }) {
  const res = await fetch('http://localhost:3001/api/weather', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city, unit })
  });
  if (!res.ok) throw new Error(`天气查询失败: ${res.status}`);
  return await res.json();
}

// 网络搜索（走后端代理）
async function web_search({ query, count = 5 }) {
  const res = await fetch('http://localhost:3001/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, count })
  });
  if (!res.ok) throw new Error(`搜索失败: ${res.status}`);
  return await res.json();
}

// 代码执行（浏览器端沙箱）
function run_code({ code }) {
  try {
    // 使用 Function 构造器创建隔离作用域
    const fn = new Function(`
      'use strict';
      const console = { log: (...args) => args.join(' '), error: (...args) => args.join(' ') };
      try {
        const result = (function() { ${code} })();
        return result;
      } catch(e) {
        throw e;
      }
    `);
    const result = fn();
    return {
      success: true,
      output: result !== undefined ? String(result) : '代码执行完毕（无返回值）',
      language: 'javascript'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      language: 'javascript'
    };
  }
}

// 数学计算（浏览器端）
function calculate({ expression }) {
  try {
    // 只允许安全的数学表达式
    const sanitized = expression.replace(/[^0-9+\-*/().,%^MathsqrincloageflPIE\s]/g, '');
    const fn = new Function(`'use strict'; return (${sanitized})`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) {
      return { success: false, error: '计算结果不是有效数字' };
    }
    return { success: true, result, expression };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 工具路由表
const toolHandlers = {
  get_weather,
  web_search,
  run_code,
  calculate
};

/**
 * 执行单个工具调用
 * @param {string} name - 工具名
 * @param {object} args - 工具参数（已解析的 JSON 对象）
 * @returns {Promise<string>} - 返回序列化为字符串的结果
 */
export async function executeTool(name, args) {
  const handler = toolHandlers[name];
  if (!handler) {
    return JSON.stringify({ error: `未知工具: ${name}` });
  }
  try {
    const result = await handler(args);
    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ error: error.message });
  }
}

/**
 * 执行所有 tool_calls（并行）
 * @param {Array} toolCalls - AI 返回的 tool_calls 数组
 * @returns {Promise<Array>} - tool 角色的消息数组
 */
export async function executeToolCalls(toolCalls) {
  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const { id, function: { name, arguments: argsStr } } = toolCall;
      let args = {};
      try {
        args = JSON.parse(argsStr);
      } catch {
        args = {};
      }
      const content = await executeTool(name, args);
      return {
        role: 'tool',
        tool_call_id: id,
        name,
        content
      };
    })
  );
  return results;
}
