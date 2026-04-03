import { createContext, useState, useEffect, useRef, useCallback } from "react";
import streamParser from "../services/streamParser";
import { MessageFSM } from "../services/messageFSM";
import { toolDefinitions } from "../services/toolDefinitions";
import { executeToolCalls } from "../services/toolExecutor";

export const Context = createContext();

const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1280;
const COMPRESSED_IMAGE_QUALITY = 0.82;

const getMessageText = (message) => (typeof message?.content === "string" ? message.content.trim() : "");

const getMessageTitle = (message) => {
  const text = getMessageText(message);
  if (text) return text.slice(0, 20);

  const firstAttachment = message?.attachments?.[0];
  if (firstAttachment?.name) {
    return `[图片] ${firstAttachment.name}`.slice(0, 20);
  }

  return "";
};

const formatAttachmentSummary = (attachment) => {
  const sizeInKb = Math.max(1, Math.round((attachment.size || 0) / 1024));
  const dimensions =
    attachment.width && attachment.height ? `，尺寸 ${attachment.width}x${attachment.height}` : "";

  return `${attachment.name}（${sizeInKb}KB${dimensions}）`;
};

const buildApiMessage = (message) => {
  const text = getMessageText(message);
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];

  if (!attachments.length) {
    return {
      role: message.role,
      content: text
    };
  }

  const attachmentBlock = attachments
    .map((attachment) => `[用户上传图片：${formatAttachmentSummary(attachment)}]`)
    .join("\n");

  return {
    role: message.role,
    content: text ? `${text}\n\n${attachmentBlock}` : attachmentBlock
  };
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("解析图片失败"));
    image.src = src;
  });

const compressImage = async (file) => {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);

  const ratio = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器不支持图片处理");
  }

  context.drawImage(image, 0, 0, width, height);

  return {
    id: `image-${Date.now()}`,
    name: file.name,
    type: "image/jpeg",
    size: file.size,
    width,
    height,
    previewUrl: canvas.toDataURL("image/jpeg", COMPRESSED_IMAGE_QUALITY)
  };
};

const ContextProvider = (props) => {
  const [input, setInput] = useState("");
  const [recentPrompt, setRecentPrompt] = useState("");
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem("dream-chat-sessions");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    try {
      return localStorage.getItem("dream-chat-current-session-id")
        ? Number(localStorage.getItem("dream-chat-current-session-id"))
        : null;
    } catch {
      return null;
    }
  });
  const [showResult, setShowResult] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultData, setResultData] = useState("");
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [recordingAnimation, setRecordingAnimation] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);

  const chatContainerRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const currentSessionIdRef = useRef(currentSessionId);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const createNewSession = useCallback(() => {
    const newSession = {
      id: Date.now(),
      title: "New Chat",
      messages: [],
      createdAt: new Date().toISOString(),
      showResult: false,
      resultData: "",
      isGenerating: false,
      input: ""
    };

    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setMessages([]);
    setShowResult(false);
    setResultData("");
    setInput("");
    setLoading(false);
    setIsGenerating(false);
    setPendingImage(null);
  }, []);

  const loadSession = useCallback(
    (sessionId) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return;

      setCurrentSessionId(sessionId);
      setMessages(session.messages);
      setShowResult(session.showResult !== undefined ? session.showResult : session.messages.length > 0);
      setRecentPrompt(session.title);
      setResultData(session.resultData || "");
      setIsGenerating(session.isGenerating || false);
      setInput(session.input || "");
      setPendingImage(null);
    },
    [sessions]
  );

  const deleteSession = useCallback(
    (sessionId) => {
      setSessions((prev) => {
        const updatedSessions = prev.filter((session) => session.id !== sessionId);

        if (currentSessionId === sessionId) {
          if (updatedSessions.length > 0) {
            setTimeout(() => loadSession(updatedSessions[0].id), 0);
          } else {
            setTimeout(() => createNewSession(), 0);
          }
        }

        return updatedSessions;
      });
    },
    [currentSessionId, loadSession, createNewSession]
  );

  const updateSessionMessages = useCallback((newMessages, additionalState = {}) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === currentSessionIdRef.current
          ? {
              ...session,
              messages: newMessages,
              title: getMessageTitle(newMessages.find((message) => message.role === "user")) || "New Chat",
              showResult:
                additionalState.showResult !== undefined ? additionalState.showResult : session.showResult,
              resultData:
                additionalState.resultData !== undefined ? additionalState.resultData : session.resultData,
              isGenerating:
                additionalState.isGenerating !== undefined ? additionalState.isGenerating : session.isGenerating,
              input: additionalState.input !== undefined ? additionalState.input : session.input
            }
          : session
      )
    );
  }, []);

  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
      return;
    }

    if (!currentSessionId) return;

    const session = sessions.find((item) => item.id === currentSessionId);
    if (!session) return;

    setMessages(session.messages);
    setShowResult(session.messages.length > 0);
    setResultData(session.resultData || "");
    setInput(session.input || "");
    setPendingImage(null);
  }, []);

  useEffect(() => {
    try {
      const toSave = sessions.map((session) => ({
        ...session,
        isGenerating: false,
        messages: session.messages.map((message) =>
          message.status === "generating" ? { ...message, status: "completed" } : message
        )
      }));

      localStorage.setItem("dream-chat-sessions", JSON.stringify(toSave));
    } catch (error) {
      console.warn("localStorage 写入失败:", error);
    }
  }, [sessions]);

  useEffect(() => {
    if (currentSessionId !== null) {
      localStorage.setItem("dream-chat-current-session-id", String(currentSessionId));
    }
  }, [currentSessionId]);

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current && !isUserScrollingRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = () => {
    if (!chatContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    isUserScrollingRef.current = !isAtBottom;

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 1000);
  };

  const clearPendingImage = useCallback(() => {
    setPendingImage(null);
  }, []);

  const handleImageUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      window.alert("只能上传图片文件");
      return;
    }

    if (file.size > MAX_IMAGE_FILE_SIZE) {
      window.alert("图片不能超过 10MB");
      return;
    }

    try {
      const attachment = await compressImage(file);
      setPendingImage(attachment);
    } catch (error) {
      console.error("Image upload error:", error);
      window.alert(error.message || "图片处理失败");
    }
  }, []);

  const runStreamLoop = useCallback(
    async (apiMessages, aiMessage, allMessages, setMsgs, fsm) => {
      let fullContent = "";
      const ctx = { apiMessages, allMessages, aiMessage, aborted: false };
      let toolsEnabled = true;

      const finalize = (status) => {
        const finalMessages = ctx.allMessages.map((message) =>
          message.id === ctx.aiMessage.id
            ? { ...message, status, content: fullContent, fsmState: status, toolCalls: message.toolCalls }
            : message
        );

        setMsgs(finalMessages);
        updateSessionMessages(finalMessages, { resultData: fullContent, isGenerating: false });
        setIsGenerating(false);
        setResultData(fullContent);
      };

      while (true) {
        fsm.dispatch("SEND");

        await new Promise((resolve, reject) => {
          streamParser.fetchStream(
            ctx.apiMessages,
            (chunk) => {
              fsm.dispatch("TEXT_DELTA");
              fullContent += chunk;

              const updated = ctx.allMessages.map((message) =>
                message.id === ctx.aiMessage.id
                  ? { ...message, content: fullContent, fsmState: fsm.getState() }
                  : message
              );

              ctx.allMessages = updated;
              setMsgs(updated);
              updateSessionMessages(updated, { resultData: fullContent });
              scrollToBottom();
            },
            (error) => {
              console.error("Stream error:", error);

              if (toolsEnabled && fullContent === "") {
                console.warn("[FSM] Disable tools and retry");
                toolsEnabled = false;
                fsm.state = "idle";
                resolve({ done: false });
              } else {
                fsm.dispatch("ERROR");
                finalize("failed");
                reject(error);
              }
            },
            () => {
              fsm.dispatch("DONE");
              finalize("completed");
              resolve({ done: true });
            },
            async (toolCalls) => {
              try {
                fsm.dispatch("TOOL_DELTA");

                const withTool = ctx.allMessages.map((message) =>
                  message.id === ctx.aiMessage.id
                    ? { ...message, fsmState: "tool_calling", toolCalls }
                    : message
                );

                ctx.allMessages = withTool;
                setMsgs(withTool);
                updateSessionMessages(withTool);
                scrollToBottom();

                ctx.apiMessages = [
                  ...ctx.apiMessages,
                  { role: "assistant", content: fullContent || null, tool_calls: toolCalls }
                ];

                const toolResultMessages = await executeToolCalls(toolCalls);
                ctx.apiMessages = [...ctx.apiMessages, ...toolResultMessages];

                const withResults = ctx.allMessages.map((message) =>
                  message.id === ctx.aiMessage.id
                    ? { ...message, toolResults: toolResultMessages }
                    : message
                );

                ctx.allMessages = withResults;
                setMsgs(withResults);
                updateSessionMessages(withResults);

                fsm.dispatch("TOOL_DONE");
                fullContent = "";
                resolve({ done: false });
              } catch (error) {
                console.error("Tool execution error:", error);
                fsm.dispatch("ERROR");
                finalize("failed");
                reject(error);
              }
            },
            toolsEnabled ? toolDefinitions : null
          );
        })
          .then((result) => {
            if (result.done) ctx.aborted = true;
          })
          .catch(() => {
            ctx.aborted = true;
          });

        if (ctx.aborted) break;
      }
    },
    [scrollToBottom, updateSessionMessages]
  );

  const onSent = async (prompt) => {
    if (isGenerating) return;

    const messageText = prompt !== undefined ? prompt : input;
    const trimmedMessage = messageText.trim();
    const attachments = pendingImage ? [pendingImage] : [];

    if (!trimmedMessage && attachments.length === 0) return;

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: trimmedMessage,
      attachments,
      timestamp: new Date().toLocaleString()
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    updateSessionMessages(newMessages, { showResult: true, isGenerating: true, input: "" });
    setInput("");
    setPendingImage(null);
    setShowResult(true);
    setIsGenerating(true);
    setRecentPrompt(trimmedMessage || attachments[0]?.name || "");

    const aiMessage = {
      id: Date.now() + 1,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleString(),
      status: "generating",
      fsmState: "thinking"
    };

    const messagesWithAI = [...newMessages, aiMessage];
    setMessages(messagesWithAI);

    const fsm = new MessageFSM((prev, next) => {
      console.log(`[FSM] ${prev} -> ${next}`);
    });
    fsm.state = "idle";

    const apiMessages = newMessages.map(buildApiMessage);

    try {
      await runStreamLoop(apiMessages, aiMessage, messagesWithAI, setMessages, fsm);
    } catch {
      // Errors are handled inside runStreamLoop.
    }
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("当前浏览器不支持语音识别，请使用 Chrome");
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "zh-CN";
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceSearch(false);
      setInput(transcript);
      void onSent(transcript);
      setInput("");
      setRecordingAnimation(false);
    };
    rec.onend = () => {
      setVoiceSearch(false);
      setRecordingAnimation(false);
    };
    rec.onerror = (event) => {
      console.error("语音识别错误:", event.error);
      setVoiceSearch(false);
      setRecordingAnimation(false);
    };

    setRecognition(rec);
  }, []);

  const openVoiceSearch = () => {
    if (!voiceSearch && recognition) {
      recognition.start();
      setVoiceSearch(true);
      setRecordingAnimation(true);
    }
  };

  const regenerateMessage = useCallback(
    async (messageIndex) => {
      if (isGenerating) return;

      const userMessage = messages[messageIndex - 1];
      if (!userMessage || userMessage.role !== "user") return;

      const truncatedMessages = messages.slice(0, messageIndex);
      setMessages(truncatedMessages);
      updateSessionMessages(truncatedMessages, { isGenerating: true, showResult: true });
      setIsGenerating(true);

      const aiMessage = {
        id: Date.now(),
        role: "assistant",
        content: "",
        timestamp: new Date().toLocaleString(),
        status: "generating",
        fsmState: "thinking"
      };

      const messagesWithAI = [...truncatedMessages, aiMessage];
      setMessages(messagesWithAI);

      const fsm = new MessageFSM((prev, next) => {
        console.log(`[FSM] ${prev} -> ${next}`);
      });
      fsm.state = "idle";

      const apiMessages = truncatedMessages.map(buildApiMessage);

      try {
        await runStreamLoop(apiMessages, aiMessage, messagesWithAI, setMessages, fsm);
      } catch {
        // Errors are handled inside runStreamLoop.
      }
    },
    [isGenerating, messages, runStreamLoop, updateSessionMessages]
  );

  const abortGeneration = () => {
    streamParser.abort();
    setIsGenerating(false);

    const updatedMessages = messages.map((message) =>
      message.status === "generating"
        ? { ...message, status: "aborted", fsmState: "aborted" }
        : message
    );

    setMessages(updatedMessages);
    updateSessionMessages(updatedMessages, { isGenerating: false });
  };

  const handleKeyPress = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSent();
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
  };

  return <Context.Provider value={contextValue}>{props.children}</Context.Provider>;
};

export default ContextProvider;
