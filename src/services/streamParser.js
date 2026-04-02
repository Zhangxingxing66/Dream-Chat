class StreamParser {
  constructor() {
    this.sseBuffer = '';
    this.renderBuffer = '';
    this.textDecoder = new TextDecoder('utf-8', { stream: true });
    this.abortController = null;
    this.flushInterval = null;
    this.isFlushing = false;
    this.currentOnChunk = null;
  }

  /**
   * @param {Array}    messages    消息历史
   * @param {Function} onChunk     (text: string) => void  文本增量回调
   * @param {Function} onError     (error: Error) => void
   * @param {Function} onComplete  () => void              纯文本回答完毕
   * @param {Function} onToolCalls (toolCalls: Array) => void  收到工具调用
   * @param {Array}    tools       工具定义列表（可选）
   * @returns {Promise<void>}
   */
  async fetchStream(messages, onChunk, onError, onComplete, onToolCalls = null, tools = null) {
    this.abortController = new AbortController();
    this.sseBuffer = '';
    this.renderBuffer = '';
    this.isFlushing = false;
    this.currentOnChunk = onChunk;

    // 用于拼接跨 chunk 的 tool_calls 增量
    const toolCallsBuffer = {};

    try {
      const body = { messages };
      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.flushAll();
          this._finalizeToolCalls(toolCallsBuffer, onToolCalls, onComplete);
          this.stopFlush();
          break;
        }

        const chunk = this.textDecoder.decode(value, { stream: true });
        this.sseBuffer += chunk;

        const lines = this.sseBuffer.split('\n');
        this.sseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            this.flushAll();
            this._finalizeToolCalls(toolCallsBuffer, onToolCalls, onComplete);
            this.stopFlush();
            return;
          }

          try {
            const json = JSON.parse(data);

            if (json.error) {
              this.stopFlush();
              onError(new Error(json.error));
              return;
            }

            if (!json.choices || json.choices.length === 0) continue;

            const delta = json.choices[0].delta;
            const finishReason = json.choices[0].finish_reason;

            // ── 文本增量 ──────────────────────────────────────────────
            if (delta?.content) {
              this.addToRenderBuffer(delta.content);
            }

            // ── tool_calls 增量（流式拼接）──────────────────────────────
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsBuffer[idx]) {
                  toolCallsBuffer[idx] = {
                    id: tc.id || '',
                    type: 'function',
                    function: { name: tc.function?.name || '', arguments: '' }
                  };
                }
                if (tc.id) toolCallsBuffer[idx].id = tc.id;
                // name 只赋值，不拼接（DeepSeek 每个 chunk 都会重复发送完整 name）
                if (tc.function?.name) toolCallsBuffer[idx].function.name = tc.function.name;
                if (tc.function?.arguments) toolCallsBuffer[idx].function.arguments += tc.function.arguments;
              }
            }

            // finish_reason = tool_calls 表示这一轮结束，需要执行工具
            if (finishReason === 'tool_calls') {
              this.flushAll();
              this._finalizeToolCalls(toolCallsBuffer, onToolCalls, onComplete);
              this.stopFlush();
              return;
            }
          } catch (jsonError) {
            console.error('JSON parse error:', jsonError);
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        this.flushAll();
      } else {
        this.stopFlush();
        onError(error);
      }
    }
  }

  _finalizeToolCalls(toolCallsBuffer, onToolCalls, onComplete) {
    const toolCalls = Object.values(toolCallsBuffer);
    if (toolCalls.length > 0 && onToolCalls) {
      onToolCalls(toolCalls);
    } else {
      onComplete();
    }
  }

  addToRenderBuffer(content) {
    if (!content || content.trim() === '') return;
    this.renderBuffer += content;
    if (!this.isFlushing) {
      this.startFlush();
    }
  }

  startFlush() {
    this.isFlushing = true;
    const scheduleFlush = () => {
      if (this.renderBuffer.length > 0) {
        this.flushChunk();
      }
      if (this.isFlushing) {
        this.flushInterval = requestAnimationFrame(scheduleFlush);
      }
    };
    this.flushInterval = requestAnimationFrame(scheduleFlush);
  }

  stopFlush() {
    this.isFlushing = false;
    if (this.flushInterval) {
      cancelAnimationFrame(this.flushInterval);
      this.flushInterval = null;
    }
  }

  flushChunk() {
    if (this.renderBuffer.length === 0) return;
    const chunkSize = Math.min(8, this.renderBuffer.length);
    const chunk = this.renderBuffer.substring(0, chunkSize);
    this.renderBuffer = this.renderBuffer.substring(chunkSize);
    if (this.currentOnChunk) {
      this.currentOnChunk(chunk);
    }
  }

  flushAll() {
    while (this.renderBuffer.length > 0) {
      this.flushChunk();
    }
  }

  abort() {
    this.stopFlush();
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  reset() {
    this.stopFlush();
    this.sseBuffer = '';
    this.renderBuffer = '';
    this.textDecoder = new TextDecoder('utf-8', { stream: true });
    this.abortController = null;
    this.isFlushing = false;
    this.currentOnChunk = null;
  }
}

export default new StreamParser();
