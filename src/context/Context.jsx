import { createContext, useState, useEffect, useRef, useCallback } from "react";
import streamParser from "../services/streamParser";
import { MessageFSM } from "../services/messageFSM";
import { toolDefinitions } from "../services/toolDefinitions";
import { executeToolCalls } from "../services/toolExecutor";

export const Context = createContext();

const ContextProvider = (props) => {
  const [input, setInput] = useState("");
  const [recentPrompt, setRecentPrompt] = useState('');
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultData, setResultData] = useState('');
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [recordingAnimation, setRecordingAnimation] = useState(false);

  const chatContainerRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  // 用于在 onSent 闭包内访问最新 currentSessionId
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);

  const createNewSession = useCallback(() => {
    const newSession = {
      id: Date.now(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
      showResult: false,
      resultData: '',
      isGenerating: false,
      input: ''
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setMessages([]);
    setShowResult(false);
    setResultData("");
    setInput("");
    setLoading(false);
    setIsGenerating(false);
  }, []);

  const loadSession = useCallback((sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
      setMessages(session.messages);
      setShowResult(session.showResult !== undefined ? session.showResult : session.messages.length > 0);
      setRecentPrompt(session.title);
      setResultData(session.resultData || '');
      setIsGenerating(session.isGenerating || false);
      setInput(session.input || '');
    }
  }, [sessions]);

  const deleteSession = useCallback((sessionId) => {
    setSessions(prev => {
      const updatedSessions = prev.filter(s => s.id !== sessionId);
      if (currentSessionId === sessionId) {
        if (updatedSessions.length > 0) {
          setTimeout(() => loadSession(updatedSessions[0].id), 0);
        } else {
          setTimeout(() => createNewSession(), 0);
        }
      }
      return updatedSessions;
    });
  }, [currentSessionId, loadSession, createNewSession]);

  const updateSessionMessages = useCallback((newMessages, additionalState = {}) => {
    setSessions(prev => prev.map(session =>
      session.id === currentSessionIdRef.current
        ? {
            ...session,
            messages: newMessages,
            title: newMessages.find(m => m.role === 'user')?.content?.slice(0, 20) || 'New Chat',
            showResult: additionalState.showResult !== undefined ? additionalState.showResult : session.showResult,
            resultData: additionalState.resultData !== undefined ? additionalState.resultData : session.resultData,
            isGenerating: additionalState.isGenerating !== undefined ? additionalState.isGenerating : session.isGenerating,
            input: additionalState.input !== undefined ? additionalState.input : session.input
          }
        : session
    ));
  }, []);

  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
    }
  }, [sessions.length, createNewSession]);

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current && !isUserScrollingRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      isUserScrollingRef.current = !isAtBottom;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 1000);
    }
  };

  useEffect(() => {
    const rec = new window.webkitSpeechRecognition();
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceSearch(false);
      setInput(transcript);
      onSent(transcript);
      setInput("");
      setRecordingAnimation(false);
    };
    rec.onend = () => {
      setVoiceSearch(false);
      setRecordingAnimation(false);
    };
    setRecognition(rec);
  }, []);

  const openVoiceSearch = () => {
    if (!voiceSearch) {
      recognition.start();
      setVoiceSearch(true);
      setRecordingAnimation(true);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  //  核心：带 FSM + Tool Calling 的流式请求循环
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 运行一轮 AI 请求（可能触发多次 tool_calls 循环）
   *
   * @param {Array}    apiMessages   发给 API 的完整消息历史
   * @param {object}   aiMessage     UI 中对应的 assistant 消息对象（用于 id 匹配）
   * @param {Array}    allMessages   当前 UI 消息数组（含 user + aiMessage）
   * @param {Function} setMsgs       React setState 引用（避免闭包陈旧）
   * @param {object}   fsm           MessageFSM 实例
   */
  const runStreamLoop = useCallback(async (apiMessages, aiMessage, allMessages, setMsgs, fsm) => {
    let fullContent = '';
    const ctx = { apiMessages, allMessages, aiMessage, aborted: false };
    let toolsEnabled = true;

    const finalize = (status) => {
      const finalMessages = ctx.allMessages.map(msg =>
        msg.id === ctx.aiMessage.id
          ? { ...msg, status, content: fullContent, fsmState: status, toolCalls: msg.toolCalls }
          : msg
      );
      setMsgs(finalMessages);
      updateSessionMessages(finalMessages, { resultData: fullContent, isGenerating: false });
      setIsGenerating(false);
      setResultData(fullContent);
    };

    while (true) {
      fsm.dispatch('SEND');

      await new Promise((resolve, reject) => {
        streamParser.fetchStream(
          ctx.apiMessages,
          (chunk) => {
            fsm.dispatch('TEXT_DELTA');
            fullContent += chunk;
            const updated = ctx.allMessages.map(msg =>
              msg.id === ctx.aiMessage.id
                ? { ...msg, content: fullContent, fsmState: fsm.getState() }
                : msg
            );
            ctx.allMessages = updated;
            setMsgs(updated);
            updateSessionMessages(updated, { resultData: fullContent });
            scrollToBottom();
          },
          (error) => {
            console.error('Stream error:', error);
            // 没收到任何内容时自动降级（模型不支持 tools）
            if (toolsEnabled && fullContent === '') {
              console.warn('[FSM] 降级为不带 tools 重试');
              toolsEnabled = false;
              fsm.state = 'idle';
              resolve({ done: false });
            } else {
              fsm.dispatch('ERROR');
              finalize('failed');
              reject(error);
            }
          },
          () => {
            fsm.dispatch('DONE');
            finalize('completed');
            resolve({ done: true });
          },
          async (toolCalls) => {
            try {
              fsm.dispatch('TOOL_DELTA');
              const withTool = ctx.allMessages.map(msg =>
                msg.id === ctx.aiMessage.id
                  ? { ...msg, fsmState: 'tool_calling', toolCalls }
                  : msg
              );
              ctx.allMessages = withTool;
              setMsgs(withTool);
              updateSessionMessages(withTool);
              scrollToBottom();

              ctx.apiMessages = [
                ...ctx.apiMessages,
                { role: 'assistant', content: fullContent || null, tool_calls: toolCalls }
              ];

              const toolResultMessages = await executeToolCalls(toolCalls);
              ctx.apiMessages = [...ctx.apiMessages, ...toolResultMessages];

              const withResults = ctx.allMessages.map(msg =>
                msg.id === ctx.aiMessage.id
                  ? { ...msg, toolResults: toolResultMessages }
                  : msg
              );
              ctx.allMessages = withResults;
              setMsgs(withResults);
              updateSessionMessages(withResults);

              fsm.dispatch('TOOL_DONE');
              fullContent = '';
              resolve({ done: false });
            } catch (e) {
              console.error('Tool execution error:', e);
              fsm.dispatch('ERROR');
              finalize('failed');
              reject(e);
            }
          },
          toolsEnabled ? toolDefinitions : null
        );
      }).then(result => {
        if (result.done) ctx.aborted = true;
      }).catch(() => {
        ctx.aborted = true;
      });

      if (ctx.aborted) break;
    }
  }, [updateSessionMessages, scrollToBottom]);

  // ─────────────────────────────────────────────────────────────────────────────

  const onSent = async (prompt) => {
    if (isGenerating) return;

    const messageText = prompt !== undefined ? prompt : input;
    if (!messageText.trim()) return;

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: messageText.trim(),
      timestamp: new Date().toLocaleString()
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    updateSessionMessages(newMessages, { showResult: true, isGenerating: true, input: '' });
    setInput("");
    setShowResult(true);
    setIsGenerating(true);
    setRecentPrompt(messageText);

    const aiMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleString(),
      status: 'generating',
      fsmState: 'thinking'
    };

    const messagesWithAI = [...newMessages, aiMessage];
    setMessages(messagesWithAI);

    const fsm = new MessageFSM((prev, next) => {
      console.log(`[FSM] ${prev} → ${next}`);
    });
    // FSM 初始在 idle，runStreamLoop 内 dispatch('SEND') 会推到 thinking
    fsm.state = 'idle';

    const apiMessages = newMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    try {
      await runStreamLoop(apiMessages, aiMessage, messagesWithAI, setMessages, fsm);
    } catch {
      // 错误已在 runStreamLoop 内处理
    }
  };

  const regenerateMessage = useCallback(async (messageIndex) => {
    if (isGenerating) return;

    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== 'user') return;

    const truncatedMessages = messages.slice(0, messageIndex);
    setMessages(truncatedMessages);
    updateSessionMessages(truncatedMessages, { isGenerating: true, showResult: true });
    setIsGenerating(true);

    const aiMessage = {
      id: Date.now(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleString(),
      status: 'generating',
      fsmState: 'thinking'
    };

    const messagesWithAI = [...truncatedMessages, aiMessage];
    setMessages(messagesWithAI);

    const fsm = new MessageFSM((prev, next) => {
      console.log(`[FSM] ${prev} → ${next}`);
    });
    fsm.state = 'idle';

    const apiMessages = truncatedMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    try {
      await runStreamLoop(apiMessages, aiMessage, messagesWithAI, setMessages, fsm);
    } catch {
      // 错误已在 runStreamLoop 内处理
    }
  }, [isGenerating, messages, updateSessionMessages, runStreamLoop]);

  const abortGeneration = () => {
    streamParser.abort();
    setIsGenerating(false);
    const updatedMessages = messages.map(msg =>
      msg.status === 'generating'
        ? { ...msg, status: 'aborted', fsmState: 'aborted' }
        : msg
    );
    setMessages(updatedMessages);
    updateSessionMessages(updatedMessages, { isGenerating: false });
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSent();
    }
  };

  const contextValue = {
    sessions,
    currentSessionId,
    createNewSession,
    loadSession,
    deleteSession,
    onSent,
    setRecentPrompt,
    recentPrompt,
    showResult,
    loading,
    resultData,
    input,
    setInput,
    handleKeyPress,
    voiceSearch,
    openVoiceSearch,
    recordingAnimation,
    setRecordingAnimation,
    messages,
    isGenerating,
    abortGeneration,
    regenerateMessage,
    chatContainerRef,
    handleScroll,
    updateSessionMessages,
    scrollToBottom
  };

  return (
    <Context.Provider value={contextValue}>
      {props.children}
    </Context.Provider>
  );
};

export default ContextProvider;
