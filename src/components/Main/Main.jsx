import React, { useContext, useEffect, useRef } from "react";
import "./Main.css";
import { assets } from "../../assets/assets";
import { Context } from "../../context/Context";
import MarkdownRenderer from "../MarkdownRenderer/MarkdownRenderer";

const TOOL_LABELS = {
  get_weather: "Weather",
  web_search: "Web Search",
  run_code: "Run Code",
  calculate: "Calculate"
};

const TOOL_ICONS = {
  get_weather: "[W]",
  web_search: "[S]",
  run_code: "[C]",
  calculate: "[M]"
};

const ToolCallCard = ({ toolCall, toolResult }) => {
  const name = toolCall.function?.name || "unknown";
  let args = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || "{}");
  } catch {
    args = {};
  }

  let result = null;
  if (toolResult) {
    try {
      result = JSON.parse(toolResult.content);
    } catch {
      result = toolResult.content;
    }
  }

  return (
    <details className="tool-card">
      <summary className="tool-card-summary">
        <span className="tool-icon">{TOOL_ICONS[name] || "[T]"}</span>
        <span className="tool-name">{TOOL_LABELS[name] || name}</span>
        <span className="tool-args-preview">
          {Object.values(args)[0] ? `"${String(Object.values(args)[0]).slice(0, 30)}"` : ""}
        </span>
        {toolResult ? <span className="tool-done">Done</span> : <span className="tool-running">...</span>}
      </summary>
      <div className="tool-card-body">
        <div className="tool-input">
          <span className="tool-label">Input</span>
          <code>{JSON.stringify(args, null, 2)}</code>
        </div>
        {result && (
          <div className="tool-output">
            <span className="tool-label">Output</span>
            {typeof result === "object" ? (
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

const ToolResultView = ({ name, result }) => {
  if (result.error) {
    return <span className="tool-error">{result.error}</span>;
  }

  if (name === "get_weather") {
    return (
      <div className="weather-result">
        <div className="weather-temp">{result.temperature}</div>
        <div className="weather-desc">{result.description}</div>
        <div className="weather-meta">
          <span>Feels like {result.feels_like}</span>
          <span>Humidity {result.humidity}</span>
          <span>Wind {result.wind_speed}</span>
        </div>
      </div>
    );
  }

  if (name === "web_search") {
    return (
      <div className="search-results-wrap">
        {result.answer && <div className="search-answer">{result.answer}</div>}
        <ul className="search-results">
          {(result.results || []).slice(0, 3).map((item, index) => (
            <li key={index}>
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
              <span className="search-source">{item.source}</span>
              <p>{item.snippet?.slice(0, 120)}...</p>
            </li>
          ))}
          {(!result.results || result.results.length === 0) && (
            <li className="no-results">{result.note || "No results"}</li>
          )}
        </ul>
      </div>
    );
  }

  if (name === "run_code" || name === "calculate") {
    const output = result.output ?? result.result ?? result.error;
    return <code className={result.success === false ? "tool-error" : ""}>{String(output)}</code>;
  }

  return <code>{JSON.stringify(result, null, 2)}</code>;
};

const FsmIndicator = ({ fsmState }) => {
  const config = {
    thinking: { text: "Thinking...", cls: "fsm-thinking" },
    tool_calling: { text: "Using tools...", cls: "fsm-tool" },
    answering: { text: "Replying...", cls: "fsm-answering" }
  };
  const current = config[fsmState];
  if (!current) return null;

  return <div className={`fsm-indicator ${current.cls}`}>{current.text}</div>;
};

const AttachmentPreview = ({ attachment, compact = false }) => (
  <div className={`attachment-preview ${compact ? "compact" : ""}`}>
    <img src={attachment.previewUrl} alt={attachment.name} className="attachment-image" />
    <div className="attachment-meta">
      <span className="attachment-name">{attachment.name}</span>
      {attachment.width && attachment.height && (
        <span className="attachment-dimensions">
          {attachment.width} x {attachment.height}
        </span>
      )}
    </div>
  </div>
);

const Main = () => {
  const {
    onSent,
    showResult,
    setInput,
    input,
    handleKeyPress,
    openVoiceSearch,
    voiceSearch,
    recordingAnimation,
    pendingImage,
    handleImageUpload,
    clearPendingImage,
    messages,
    isGenerating,
    abortGeneration,
    regenerateMessage,
    chatContainerRef,
    handleScroll,
    updateSessionMessages,
    scrollToBottom
  } = useContext(Context);

  const fileInputRef = useRef(null);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setInput(value);
    updateSessionMessages(messages, { input: value });
  };

  const openImagePicker = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const canSend = Boolean(input.trim() || pendingImage);

  return (
    <div className="main">
      <div className="nav">
        <p>dreamAI</p>
        <img src={assets.user_icon} alt="user" />
      </div>

      <div className="main-container">
        {!showResult ? (
          <>
            <div className="greet">
              <p>
                <span>hello, yuan</span>
              </p>
              <p>How can I help you?</p>
            </div>

            <div className="cards">
              <div className="card" onClick={() => onSent("北京今天天气怎么样？")}>
                <p>北京今天天气怎么样？</p>
                <img src={assets.compass_icon} alt="weather" />
              </div>
              <div className="card" onClick={() => onSent("搜索一下最新的 AI 新闻")}>
                <p>搜索一下最新的 AI 新闻</p>
                <img src={assets.bulb_icon} alt="search" />
              </div>
              <div className="card" onClick={() => onSent("计算 1024 的平方根")}>
                <p>计算 1024 的平方根</p>
                <img src={assets.message_icon} alt="calculate" />
              </div>
              <div className="card" onClick={() => onSent("提升以下代码的可读性")}>
                <p>提升以下代码的可读性</p>
                <img src={assets.code_icon} alt="code" />
              </div>
            </div>
          </>
        ) : (
          <div className="result">
            <div className="chat-messages" ref={chatContainerRef} onScroll={handleScroll}>
              {messages.map((message, index) => (
                <div
                  key={message.id || index}
                  className={`message-item ${message.role === "assistant" ? "ai-message" : "user-message"}`}
                >
                  <img
                    src={message.role === "assistant" ? assets.gemini_icon : assets.user_icon}
                    alt={message.role}
                    className="message-avatar"
                  />
                  <div className="message-content">
                    {message.role === "assistant" && message.status === "generating" && (
                      <FsmIndicator fsmState={message.fsmState} />
                    )}

                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="tool-calls-list">
                        {message.toolCalls.map((toolCall, toolIndex) => {
                          const result = message.toolResults?.find(
                            (item) => item.tool_call_id === toolCall.id
                          );
                          return (
                            <ToolCallCard
                              key={toolCall.id || toolIndex}
                              toolCall={toolCall}
                              toolResult={result}
                            />
                          );
                        })}
                      </div>
                    )}

                    {message.attachments?.length > 0 && (
                      <div className="message-attachments">
                        {message.attachments.map((attachment) => (
                          <AttachmentPreview
                            key={attachment.id || attachment.previewUrl}
                            attachment={attachment}
                            compact
                          />
                        ))}
                      </div>
                    )}

                    {message.status === "generating" && !message.content ? (
                      <div className="loader">
                        <hr />
                        <hr />
                        <hr />
                      </div>
                    ) : message.content ? (
                      <div className="markdown-content">
                        <MarkdownRenderer content={message.content} />
                      </div>
                    ) : null}

                    {message.status === "aborted" && <span className="message-status">已中断</span>}
                    {message.status === "failed" && (
                      <span className="message-status error">生成失败</span>
                    )}

                    {message.role === "assistant" &&
                      (message.status === "completed" ||
                        message.status === "aborted" ||
                        message.status === "failed") &&
                      !isGenerating && (
                        <button
                          className="regenerate-btn"
                          onClick={() => regenerateMessage(index)}
                          title="重新生成"
                        >
                          Retry
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="main-bottom">
          {pendingImage && (
            <div className="pending-upload">
              <AttachmentPreview attachment={pendingImage} />
              <div className="pending-upload-actions">
                <span className="pending-upload-note">当前会展示图片，但后端暂未识别图片像素内容。</span>
                <button type="button" className="remove-upload-btn" onClick={clearPendingImage}>
                  移除图片
                </button>
              </div>
            </div>
          )}

          <div className="search-box">
            <input
              onChange={handleInputChange}
              value={input}
              type="text"
              onKeyDown={handleKeyPress}
              placeholder="在这里输入提示词"
            />

            <div className="search-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden-file-input"
                onChange={handleImageUpload}
              />
              <img src={assets.gallery_icon} alt="upload" onClick={openImagePicker} />
              <img
                src={assets.mic_icon}
                alt="voice"
                onClick={openVoiceSearch}
                className={`mic-icon ${voiceSearch ? "active" : ""} ${
                  recordingAnimation ? "recording" : ""
                }`}
              />
              {isGenerating ? (
                <img
                  src={assets.send_icon}
                  alt="stop"
                  onClick={abortGeneration}
                  className="stop-icon"
                  title="停止生成"
                />
              ) : canSend ? (
                <img onClick={() => onSent()} src={assets.send_icon} alt="send" />
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
