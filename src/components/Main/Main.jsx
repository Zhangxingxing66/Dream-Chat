import React, { useContext, useEffect } from "react";
import "./Main.css";
import { assets } from "../../assets/assets";
import { Context } from "../../context/Context";
import MarkdownRenderer from "../MarkdownRenderer/MarkdownRenderer";

// 工具名称映射
const TOOL_LABELS = {
  get_weather: '查询天气',
  web_search: '网络搜索',
  run_code: '执行代码',
  calculate: '数学计算'
};

// 工具图标 emoji
const TOOL_ICONS = {
  get_weather: '🌤️',
  web_search: '🔍',
  run_code: '⚙️',
  calculate: '🧮'
};

// 工具调用卡片（折叠式）
const ToolCallCard = ({ toolCall, toolResult }) => {
  const name = toolCall.function?.name || 'unknown';
  let args = {};
  try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch {}

  let result = null;
  if (toolResult) {
    try { result = JSON.parse(toolResult.content); } catch { result = toolResult.content; }
  }

  return (
    <details className="tool-card">
      <summary className="tool-card-summary">
        <span className="tool-icon">{TOOL_ICONS[name] || '🔧'}</span>
        <span className="tool-name">{TOOL_LABELS[name] || name}</span>
        <span className="tool-args-preview">
          {Object.values(args)[0] ? `"${String(Object.values(args)[0]).slice(0, 30)}"` : ''}
        </span>
        {toolResult ? <span className="tool-done">✓</span> : <span className="tool-running">...</span>}
      </summary>
      <div className="tool-card-body">
        <div className="tool-input">
          <span className="tool-label">输入</span>
          <code>{JSON.stringify(args, null, 2)}</code>
        </div>
        {result && (
          <div className="tool-output">
            <span className="tool-label">输出</span>
            {typeof result === 'object' ? (
              <ToolResultView name={name} result={result} />
            ) : (
              <code>{String(result)}</code>
            )}
          </div>
        )}
      </div>
    </details>
  );
};

// 根据工具类型渲染结构化结果
const ToolResultView = ({ name, result }) => {
  if (result.error) {
    return <span className="tool-error">{result.error}</span>;
  }

  if (name === 'get_weather') {
    return (
      <div className="weather-result">
        <div className="weather-temp">{result.temperature}</div>
        <div className="weather-desc">{result.description}</div>
        <div className="weather-meta">
          <span>体感 {result.feels_like}</span>
          <span>湿度 {result.humidity}</span>
          <span>风速 {result.wind_speed}</span>
        </div>
      </div>
    );
  }

  if (name === 'web_search') {
    return (
      <ul className="search-results">
        {(result.results || []).slice(0, 3).map((r, i) => (
          <li key={i}>
            <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
            <p>{r.snippet?.slice(0, 100)}…</p>
          </li>
        ))}
        {(!result.results || result.results.length === 0) && (
          <li className="no-results">{result.note || '无结果'}</li>
        )}
      </ul>
    );
  }

  if (name === 'run_code' || name === 'calculate') {
    const output = result.output ?? result.result ?? result.error;
    return <code className={result.success === false ? 'tool-error' : ''}>{String(output)}</code>;
  }

  return <code>{JSON.stringify(result, null, 2)}</code>;
};

// FSM 状态指示器
const FsmIndicator = ({ fsmState }) => {
  const config = {
    thinking:     { text: '思考中…',   cls: 'fsm-thinking' },
    tool_calling: { text: '调用工具…', cls: 'fsm-tool' },
    answering:    { text: '回答中…',   cls: 'fsm-answering' },
  };
  const c = config[fsmState];
  if (!c) return null;
  return <div className={`fsm-indicator ${c.cls}`}>{c.text}</div>;
};

const Main = () => {
  const {
    onSent,
    recentPrompt,
    showResult,
    loading,
    resultData,
    setInput,
    input,
    handleKeyPress,
    openVoiceSearch,
    voiceSearch,
    recordingAnimation,
    messages,
    isGenerating,
    abortGeneration,
    regenerateMessage,
    chatContainerRef,
    handleScroll,
    updateSessionMessages,
    scrollToBottom
  } = useContext(Context);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    updateSessionMessages(messages, { input: value });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="main">
      <div className="nav">
        <p>dreamAI</p>
        <img src={assets.user_icon} alt="" />
      </div>
      <div className="main-container">
        {!showResult ? (
          <>
            <div className="greet">
              <p><span>hello, yuan</span></p>
              <p>How can I help you?</p>
            </div>
            <div className="cards">
              <div className="card" onClick={() => onSent("北京今天天气怎么样？")}>
                <p>北京今天天气怎么样？</p>
                <img src={assets.compass_icon} alt="" />
              </div>
              <div className="card" onClick={() => onSent("搜索一下最新的 AI 新闻")}>
                <p>搜索一下最新的 AI 新闻</p>
                <img src={assets.bulb_icon} alt="" />
              </div>
              <div className="card" onClick={() => onSent("计算 1024 的平方根")}>
                <p>计算 1024 的平方根</p>
                <img src={assets.message_icon} alt="" />
              </div>
              <div className="card" onClick={() => onSent("提升以下代码的可读性")}>
                <p>提升以下代码的可读性</p>
                <img src={assets.code_icon} alt="" />
              </div>
            </div>
          </>
        ) : (
          <div className="result">
            <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
              {messages.map((message, index) => (
                <div
                  key={message.id || index}
                  className={`message-item ${message.role === 'assistant' ? 'ai-message' : 'user-message'}`}
                >
                  <img
                    src={message.role === 'assistant' ? assets.gemini_icon : assets.user_icon}
                    alt=""
                    className="message-avatar"
                  />
                  <div className="message-content">

                    {/* FSM 状态指示器（仅 generating 时显示） */}
                    {message.role === 'assistant' && message.status === 'generating' && (
                      <FsmIndicator fsmState={message.fsmState} />
                    )}

                    {/* 工具调用卡片 */}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="tool-calls-list">
                        {message.toolCalls.map((tc, i) => {
                          const result = message.toolResults?.find(r => r.tool_call_id === tc.id);
                          return <ToolCallCard key={tc.id || i} toolCall={tc} toolResult={result} />;
                        })}
                      </div>
                    )}

                    {/* 消息正文 */}
                    {message.status === 'generating' && !message.content ? (
                      <div className="loader"><hr /><hr /><hr /></div>
                    ) : (
                      <div className="markdown-content">
                        <MarkdownRenderer content={message.content} />
                      </div>
                    )}

                    {message.status === 'aborted' && (
                      <span className="message-status">已中断</span>
                    )}
                    {message.status === 'failed' && (
                      <span className="message-status error">生成失败</span>
                    )}
                    {message.role === 'assistant' &&
                      (message.status === 'completed' || message.status === 'aborted' || message.status === 'failed') &&
                      !isGenerating && (
                        <button
                          className="regenerate-btn"
                          onClick={() => regenerateMessage(index)}
                          title="重新生成"
                        >
                          ↺ 重新生成
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="main-bottom">
          <div className="search-box">
            <input
              onChange={handleInputChange}
              value={input}
              type="text"
              onKeyDown={handleKeyPress}
              placeholder="在这里输入提示"
            />
            <div>
              <img src={assets.gallery_icon} alt="" />
              <img
                src={assets.mic_icon}
                alt="麦克风图标"
                onClick={openVoiceSearch}
                className={`mic-icon ${voiceSearch ? "active" : ""} ${recordingAnimation ? "recording" : ""}`}
              />
              {isGenerating ? (
                <img
                  src={assets.send_icon}
                  alt=""
                  onClick={abortGeneration}
                  className="stop-icon"
                  title="停止生成"
                />
              ) : input ? (
                <img onClick={() => onSent()} src={assets.send_icon} alt="" />
              ) : null}
            </div>
          </div>
          <p className="bottom-info">
            dreamAI 可能会显示不准确的信息，请仔细检查其回复。
          </p>
        </div>
      </div>
    </div>
  );
};

export default Main;
