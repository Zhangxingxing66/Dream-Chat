/**
 * Tool Calling 工具定义
 * 符合 OpenAI / 讯飞星火 function calling 格式
 */

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市的实时天气信息，包括温度、天气状况、湿度、风速等。',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，例如：北京、上海、广州、New York'
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: '温度单位，默认 celsius（摄氏度）'
          }
        },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取最新信息，适合查询实时新闻、近期事件、不确定的事实。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词或问题'
          },
          count: {
            type: 'number',
            description: '返回结果数量，默认 5，最多 10'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: '执行 JavaScript 代码并返回结果，支持数学计算、数据处理、字符串操作等。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 JavaScript 代码，最后一个表达式的值作为返回结果'
          },
          language: {
            type: 'string',
            enum: ['javascript'],
            description: '编程语言，目前仅支持 javascript'
          }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '执行数学计算，支持四则运算、幂运算、开方、三角函数等。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，例如：2 + 3 * 4、Math.sqrt(16)、Math.sin(Math.PI/2)'
          }
        },
        required: ['expression']
      }
    }
  }
];
